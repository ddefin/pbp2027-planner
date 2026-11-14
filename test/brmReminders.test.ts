import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-brm-reminders.db");

let prisma: typeof import("../src/db.js").prisma;
let reminders: typeof import("../src/lib/brmReminders.js");
let catalog: typeof import("../src/lib/acpCatalog.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

// « Maintenant » : mardi 9 mars 2027, 10 h à Paris. J+1 = 10 mars, J+7 = 16 mars.
const NOW = new Date("2027-03-09T09:00:00Z");
const acp = (date: string, distance: number, ville: string) => ({ Date: date, Distance: distance, Pays: "France", SiteWeb: "", Ville: ville, Departement: "", Region: "", RoadMap: "", Denivele: 0, Contact: "", NomClub: `Club ${ville}` });
const FAKE = [acp("10/03/2027", 200, "Rambouillet"), acp("16/03/2027", 300, "Gacé"), acp("20/03/2027", 400, "Troyes"), acp("01/03/2027", 200, "Chartres")];
let telegram: string[] = [];
let acpDown = false;

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "e5".repeat(32);
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.OPENWEATHER_API_KEY = "test-key";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ prisma } = await import("../src/db.js"));
  reminders = await import("../src/lib/brmReminders.js");
  catalog = await import("../src/lib/acpCatalog.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  telegram = [];
  acpDown = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        telegram.push(JSON.parse(String(init?.body)).text);
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      if (u.includes("/forecast"))
        return new Response(JSON.stringify({ list: [{ dt: Date.parse("2027-03-10T06:00:00Z") / 1000, main: { temp: 6.4 }, weather: [{ description: "pluie faible" }], wind: { speed: 5, deg: 225 }, pop: 0.6 }] }), { status: 200 });
      if (u.includes("openweathermap")) return new Response(JSON.stringify({ name: "Rambouillet", main: { temp: 8, feels_like: 6, humidity: 80 }, weather: [{ description: "couvert", icon: "04d" }], wind: { speed: 4, deg: 200 } }), { status: 200 });
      if (acpDown) return new Response("down", { status: 503 });
      return new Response(JSON.stringify(FAKE), { status: 200 });
    }),
  );
});

describe("Rappels avant un BRM", () => {
  const ids: Record<string, string> = {};
  const ev: Record<string, string> = {};

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(FAKE), { status: 200 })));
    const events = await catalog.fetchFranceBrmCatalog({ from: "2027-01-01", to: "2027-06-30", distances: [200, 300, 400, 600, 1000] });
    for (const e of events) ev[e.ville] = e.id;
    const mk = async (key: string, extra: object = {}) => (ids[key] = (await prisma.user.create({ data: { email: `${key}@example.com`, prenom: key, passwordHash: "x", ...extra } })).id);
    await mk("anna");
    await mk("bruno");
    await mk("suspendu", { suspendedAt: new Date() });
    await prisma.telegramLink.create({ data: { userId: ids.anna, chatId: "42" } });
    const choose = (user: string, ville: string, status: string) => prisma.brmParticipation.create({ data: { userId: ids[user], catalogEventId: ev[ville], status } });
    await choose("anna", "Rambouillet", "inscrit"); // demain
    await choose("anna", "Gacé", "prevu"); // dans 7 jours
    await choose("anna", "Troyes", "prevu"); // dans 11 jours : pas encore
    await choose("anna", "Chartres", "prevu"); // passé
    await choose("bruno", "Rambouillet", "homologue"); // déjà homologué : pas de rappel
    await choose("suspendu", "Rambouillet", "inscrit"); // compte suspendu
  });

  it("n'envoie rien avant 7 h (heure de Paris), ni si le calendrier ACP est injoignable", async () => {
    expect(await reminders.sendBrmReminders(new Date("2027-03-09T04:30:00Z"))).toBe(0);
    acpDown = true;
    expect(await reminders.sendBrmReminders(NOW)).toBe(0);
    expect(await prisma.brmReminder.count()).toBe(0);
  });

  it("envoie J-1 (avec la météo du départ) et J-7, à la bonne personne seulement", async () => {
    expect(await reminders.sendBrmReminders(NOW)).toBe(2);
    const notes = await prisma.notification.findMany({ where: { kind: "brm_reminder" }, orderBy: { message: "asc" } });
    expect(notes.every((n) => n.userId === ids.anna && n.link === "/calendrier")).toBe(true);
    const j1 = notes.find((n) => n.message.includes("Demain"))!;
    expect(j1.message).toContain("BRM 200 km à Rambouillet");
    expect(j1.message).toContain("Météo vers 7 h : 6°, pluie faible, vent 18 km/h SO, pluie 60 %");
    const j7 = notes.find((n) => n.message.includes("J-7"))!;
    expect(j7.message).toContain("BRM 300 km à Gacé, mardi 16 mars");
    expect(telegram).toHaveLength(2); // Anna a lié Telegram
    for (const n of notes) expect(n.message).not.toMatch(/[<>&]/);
  });

  it("ne renvoie jamais deux fois le même rappel", async () => {
    expect(await reminders.sendBrmReminders(NOW)).toBe(0);
    expect(await reminders.sendBrmReminders(new Date(NOW.getTime() + 3 * 3_600_000))).toBe(0);
    expect(await prisma.notification.count({ where: { kind: "brm_reminder" } })).toBe(2);
    // Six jours plus tard, le BRM de Gacé est « demain » : le rappel J-1 part, une fois.
    expect(await reminders.sendBrmReminders(new Date("2027-03-15T09:00:00Z"))).toBe(1);
    expect(await reminders.sendBrmReminders(new Date("2027-03-15T10:00:00Z"))).toBe(0);
  });
});
