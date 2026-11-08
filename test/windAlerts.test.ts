import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-wind-alerts.db");

let prisma: typeof import("../src/db.js").prisma;
let checkWindAlerts: typeof import("../src/lib/windAlerts.js").checkWindAlerts;
let fetchFranceBrmCatalog: typeof import("../src/lib/acpCatalog.js").fetchFranceBrmCatalog;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

// Décalé de 2 jours : dans la fenêtre des prévisions gratuites (5 jours) sans
// coller à "aujourd'hui", pour rester robuste aux fuseaux horaires.
const targetDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const targetDateIso = targetDate.toISOString().slice(0, 10); // yyyy-mm-dd
const [y, m, d] = targetDateIso.split("-");
const targetDateFr = `${d}/${m}/${y}`; // format attendu par l'API ACP mockée

let windSpeedMs = 15; // ~54 km/h par défaut (au-dessus du seuil par défaut de 50)
let webhookCalls: ReturnType<typeof vi.fn>;

function stubFetch(ville: string, club: string) {
  webhookCalls = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("hooks.example")) return webhookCalls();
      if (url.includes("/forecast")) {
        return new Response(
          JSON.stringify({
            list: [
              {
                dt: Math.floor(targetDate.getTime() / 1000),
                main: { temp: 12 },
                wind: { speed: windSpeedMs, deg: 270 },
                weather: [{ description: "venteux" }],
                pop: 0.1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("openweathermap")) {
        return new Response(
          JSON.stringify({
            name: ville,
            main: { temp: 12, feels_like: 10, humidity: 70 },
            wind: { speed: windSpeedMs, deg: 270 },
            weather: [{ description: "venteux" }],
            dt: Math.floor(Date.now() / 1000),
          }),
          { status: 200 },
        );
      }
      // Catalogue ACP.
      return new Response(
        JSON.stringify([
          {
            Date: targetDateFr,
            Distance: 200,
            Pays: "France",
            SiteWeb: "",
            Ville: ville,
            Departement: "Test",
            Region: "Test",
            RoadMap: "",
            Denivele: 1000,
            Contact: "",
            NomClub: club,
          },
        ]),
        { status: 200 },
      );
    }),
  );
}

async function createUser(email: string) {
  return prisma.user.create({ data: { email, prenom: "Test", passwordHash: "x" } });
}

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "33".repeat(32);
  process.env.OPENWEATHER_API_KEY = "test-key";
  process.env.WIND_ALERT_THRESHOLD_KMH = "50";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ prisma } = await import("../src/db.js"));
  ({ checkWindAlerts } = await import("../src/lib/windAlerts.js"));
  ({ fetchFranceBrmCatalog } = await import("../src/lib/acpCatalog.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanupDbFiles();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await prisma.windAlertSent.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.brmParticipation.deleteMany();
});

describe("checkWindAlerts", () => {
  it("déclenche l'alerte une fois quand le vent dépasse le seuil, pas de doublon à la vérification suivante", async () => {
    windSpeedMs = 15; // 54 km/h
    stubFetch("Ventville", "Club Vent");

    const [event] = await fetchFranceBrmCatalog({ from: targetDateIso, to: targetDateIso, distances: [200] });
    const user = await createUser(`wind-fort-${Date.now()}@example.com`);
    await prisma.brmParticipation.create({ data: { userId: user.id, catalogEventId: event.id, status: "prevu" } });
    await prisma.webhookSubscription.create({
      data: { userId: user.id, url: "https://hooks.example/webhook", format: "generic", events: "meteo.vent_fort" },
    });

    await checkWindAlerts();

    const sent = await prisma.windAlertSent.findMany({ where: { catalogEventId: event.id } });
    expect(sent).toHaveLength(1);
    expect(sent[0].forecastDate).toBe(event.date);
    expect(webhookCalls).toHaveBeenCalledTimes(1);

    const sub = await prisma.webhookSubscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(sub.lastStatus).toBe("ok");

    // Deuxième passage (ex. 6h plus tard) : ne doit pas renvoyer une deuxième alerte.
    await checkWindAlerts();
    const sentAgain = await prisma.windAlertSent.findMany({ where: { catalogEventId: event.id } });
    expect(sentAgain).toHaveLength(1);
    expect(webhookCalls).toHaveBeenCalledTimes(1);
  });

  it("ne déclenche rien quand le vent reste sous le seuil", async () => {
    windSpeedMs = 3; // ~11 km/h
    stubFetch("Calmeville", "Club Calme");

    const [event] = await fetchFranceBrmCatalog({ from: targetDateIso, to: targetDateIso, distances: [200] });
    const user = await createUser(`wind-calme-${Date.now()}@example.com`);
    await prisma.brmParticipation.create({ data: { userId: user.id, catalogEventId: event.id, status: "inscrit" } });
    await prisma.webhookSubscription.create({
      data: { userId: user.id, url: "https://hooks.example/webhook", format: "generic", events: "meteo.vent_fort" },
    });

    await checkWindAlerts();

    const sent = await prisma.windAlertSent.findMany({ where: { catalogEventId: event.id } });
    expect(sent).toHaveLength(0);
    expect(webhookCalls).not.toHaveBeenCalled();
  });

  it("ignore un BRM que personne n'a choisi", async () => {
    windSpeedMs = 20; // bien au-dessus du seuil
    stubFetch("Sansparticipant", "Club Seul");

    // Pas de BrmParticipation créée pour cet événement.
    await checkWindAlerts();

    const sent = await prisma.windAlertSent.findMany();
    expect(sent).toHaveLength(0);
    expect(webhookCalls).not.toHaveBeenCalled();
  });
});
