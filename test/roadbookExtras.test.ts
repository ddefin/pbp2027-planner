import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-roadbook-extras.db");
const uploadsDir = path.resolve(repoRoot, "data-test-rb-extras");
const heartbeat = path.resolve(repoRoot, "data-test-rb-extras-backup");
const NEWS = "-1006666666666";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let calc: typeof import("../src/shared/roadbookCalc.js");
let backup: typeof import("../src/lib/backupWatch.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  for (const d of [uploadsDir, heartbeat]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
const lonAt = (km: number) => 2 - km / KM_PER_DEG_LON;
function straightGpx(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 2000; i++) pts.push(`<trkpt lat="48" lon="${lonAt(i / 10).toFixed(6)}"><ele>100</ele></trkpt>`);
  const wpt = (km: number, name: string) => `<wpt lat="48.0005" lon="${lonAt(km)}"><name>${name}</name></wpt>`;
  return `<?xml version="1.0"?><gpx version="1.1">${wpt(100, "CP1 Bourg")}${wpt(40, "Boulangerie Dupont")}${wpt(70, "Fontaine du village")}<trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

let sent: { chatId: string; text: string }[] = [];

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "99".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_NEWS_CHAT_ID = NEWS;
  process.env.BACKUP_HEARTBEAT_FILE = path.join(heartbeat, ".last-backup");
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  calc = await import("../src/shared/roadbookCalc.js");
  backup = await import("../src/lib/backupWatch.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body));
        sent.push({ chatId: String(body.chat_id), text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Plan nutrition", () => {
  const row = (index: number, name: string, km: number, arriveMin: number, stop = 0) => ({
    index, name, km, legKm: 0, legGainM: null, arriveMin, departMin: arriveMin + stop, stopMinutes: stop, openMin: 0, closeMin: 9999, marginMin: 0,
  });
  const schedule = [row(0, "Départ", 0, 0), row(1, "CP1", 100, 240, 20), row(2, "Arrivée", 200, 520)];

  it("calcule eau et glucides sur le temps de roulage, hors pauses", () => {
    const plan = calc.nutritionPlan(schedule, []);
    expect(plan.segments[0].rideMin).toBe(240);
    expect(plan.segments[0].waterMl).toBe(2000); // 4 h × 500 ml
    expect(plan.segments[0].carbsG).toBe(240); // 4 h × 60 g
    expect(plan.segments[1].rideMin).toBe(260); // 520 - (240+20)
    expect(plan.totalKcal).toBe(plan.totalCarbsG * 4);
  });

  it("repère les points d'eau/ravito et signale un tronçon sans rien", () => {
    const plan = calc.nutritionPlan(schedule, [{ name: "Boulangerie Dupont", km: 40 }, { name: "Fontaine du village", km: 70 }, { name: "Église", km: 80 }]);
    expect(plan.segments[0].stops.map((s) => s.kind)).toEqual(["ravito", "eau"]);
    expect(plan.segments[0].longestGapKm).toBe(40); // 0→40, 40→70, 70→100
    expect(plan.segments[0].needsRefill).toBe(false);
    expect(plan.segments[1].stops).toEqual([]);
    expect(plan.segments[1].needsRefill).toBe(true); // 100 km, 2,2 L d'eau > 1,5 L embarqués
  });
});

describe("Check-list, exports GPS et suivi en direct", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let id: string;

  beforeAll(async () => {
    server = buildServer();
    const email = `rb-extra-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const boundary = "----ex" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BRM 200 & co.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
      Buffer.from(straightGpx()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    id = up.json().roadbook.id;
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${id}`, headers: { cookie }, payload: { startAt: new Date(Date.now() - 3 * 3600_000).toISOString() } });
  });

  it("enregistre la check-list, sans jamais l'exposer sur le lien public", async () => {
    const items = [{ id: "lampe-av", label: "Lampe <chargée>", done: true }];
    const res = await server.inject({ method: "PATCH", url: `/api/roadbooks/${id}`, headers: { cookie }, payload: { checklist: items } });
    expect(res.json().roadbook.checklist).toEqual(items);
    expect((await server.inject({ method: "PATCH", url: `/api/roadbooks/${id}`, headers: { cookie }, payload: { checklist: [{ id: "", label: "x", done: false }] } })).statusCode).toBe(400);
    const share = await server.inject({ method: "POST", url: `/api/roadbooks/${id}/share`, headers: { cookie }, payload: { enabled: true } });
    const pub = await server.inject({ method: "GET", url: `/api/roadbooks/shared/${share.json().shareToken}` });
    expect(pub.body).not.toContain("checklist");
  });

  it("exporte un GPX avec contrôles et points d'eau", async () => {
    const res = await server.inject({ method: "GET", url: `/api/roadbooks/${id}/export?format=gpx`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("gpx");
    expect(res.body).toContain("<name>CP1 Bourg</name>");
    expect(res.body).toContain("ferme ");
    expect(res.body).toContain("<sym>Drinking Water</sym>");
    expect(res.body).toContain("<sym>Restaurant</sym>");
    expect((res.body.match(/<trkpt /g) ?? []).length).toBeGreaterThanOrEqual(2); // ligne droite : tracé simplifié
    expect(String(res.headers["content-disposition"])).toMatch(/filename="[A-Za-z0-9-]+\.gpx"/);
  });

  it("exporte un TCX Course avec points de parcours aux noms courts", async () => {
    const res = await server.inject({ method: "GET", url: `/api/roadbooks/${id}/export?format=tcx`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Courses>");
    expect(res.body).toContain("<PointType>Water</PointType>");
    expect(res.body).toContain("<PointType>Food</PointType>");
    for (const m of res.body.matchAll(/<CoursePoint><Name>([^<]*)<\/Name>/g)) expect(m[1].length).toBeLessThanOrEqual(10);
    expect((await server.inject({ method: "GET", url: `/api/roadbooks/${id}/export?format=fit`, headers: { cookie } })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `/api/roadbooks/${id}/export?format=gpx` })).statusCode).toBe(401);
  });

  it("donne la vue en direct aux proches (arrivée prévue, prochain contrôle), sans session", async () => {
    const share = await server.inject({ method: "POST", url: `/api/roadbooks/${id}/share`, headers: { cookie }, payload: { enabled: true } });
    const token = share.json().shareToken;
    expect((await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}/live` })).statusCode).toBe(404); // pas de pointage
    await server.inject({ method: "POST", url: `/api/roadbooks/${id}/checkins`, headers: { cookie }, payload: { km: 60, source: "manuel" } });
    const res = await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}/live` });
    expect(res.statusCode).toBe(200);
    const live = res.json();
    expect(live.km).toBe(60);
    expect(live.kmLeft).toBeCloseTo(140, 0);
    expect(live.plannedFinishAt).toBeTruthy();
    expect(live.nextControl.name).toContain("CP1");
    expect(live.weather).toEqual([]); // pas de clé météo dans ce test
    expect((await server.inject({ method: "GET", url: "/api/roadbooks/shared/zzzzzzzzzzzzzzzzzzzz/live" })).statusCode).toBe(404);
  });
});

describe("Alerte de sauvegarde manquante", () => {
  it("prévient les admins puis se tait jusqu'au rappel, et repart OK avec un témoin récent", async () => {
    const admin = await prisma.user.create({ data: { email: `adm-bk-${Date.now()}@example.com`, passwordHash: "x", prenom: "Admin", isAdmin: true } });
    // Aucun témoin : alerte.
    const first = await backup.checkBackup();
    expect(first).toMatchObject({ ok: false, notified: true, lastAt: null });
    expect(sent.find((m) => m.chatId === NEWS)?.text).toContain("Aucune sauvegarde");
    expect(await prisma.notification.count({ where: { userId: admin.id, kind: "backup" } })).toBe(1);
    // Pas de spam le lendemain.
    expect((await backup.checkBackup(new Date(Date.now() + 86_400_000))).notified).toBe(false);
    // Rappel après 3 jours, avec l'ancienneté de la dernière sauvegarde.
    existsSync(heartbeat) || execSync(`mkdir -p ${heartbeat}`);
    writeFileSync(path.join(heartbeat, ".last-backup"), String(Math.floor(Date.now() / 1000) - 5 * 86_400));
    const again = await backup.checkBackup(new Date(Date.now() + 4 * 86_400_000));
    expect(again.notified).toBe(true);
    expect(sent.at(-1)?.text).toContain("depuis 9 jours");
    // Sauvegarde fraîche : tout va bien.
    writeFileSync(path.join(heartbeat, ".last-backup"), String(Math.floor(Date.now() / 1000)));
    expect(await backup.checkBackup()).toMatchObject({ ok: true, notified: false });
  });
});
