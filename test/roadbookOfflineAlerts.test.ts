import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-roadbook-offline.db");
const uploadsDir = path.resolve(repoRoot, "data-test-rb-offline");
const CHANNEL = "-1008888888888";
const NEWS = "-1007777777777";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let alertsLib: typeof import("../src/lib/roadbookAlerts.js");
let watchLib: typeof import("../src/lib/pbpRouteWatch.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true });
}

const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
const lonAt = (km: number) => 2 - km / KM_PER_DEG_LON;
function straightGpx(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 2000; i++) {
    const km = i / 10;
    pts.push(`<trkpt lat="48" lon="${lonAt(km).toFixed(6)}"><ele>100</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48.0005" lon="${lonAt(50)}"><name>CP1 Bourg</name></wpt><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

let sent: { chatId: string; text: string }[] = [];
let routePage = "";

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "88".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_TRACKING_CHAT_ID = CHANNEL;
  process.env.TELEGRAM_NEWS_CHAT_ID = NEWS;
  process.env.OPENWEATHER_API_KEY = "test-key";
  process.env.PUBLIC_URL = "https://pbp.example";
  process.env.ROADBOOK_SILENCE_HOURS = "3";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  alertsLib = await import("../src/lib/roadbookAlerts.js");
  watchLib = await import("../src/lib/pbpRouteWatch.js");
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
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body));
        sent.push({ chatId: String(body.chat_id), text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      if (u.includes("paris-brest-paris.org")) return new Response(routePage, { status: 200 });
      // Pas de météo dans ces tests.
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Pointages hors réseau (rattrapage)", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let roadbookId: string;
  const post = (payload: object) => server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie }, payload });

  beforeAll(async () => {
    server = buildServer();
    const email = `rb-off-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const boundary = "----off" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BRM 200.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
      Buffer.from(straightGpx()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    roadbookId = up.json().roadbook.id;
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${roadbookId}`, headers: { cookie }, payload: { startAt: new Date(Date.now() - 5 * 3600_000).toISOString(), movingSpeedKmh: 25 } });
  });

  it("enregistre l'heure réelle et ignore un renvoi du même identifiant", async () => {
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    const first = await post({ km: 20, source: "manuel", at, clientId: "client-id-0001", announce: false });
    expect(first.statusCode).toBe(201);
    expect(new Date(first.json().checkin.at).toISOString()).toBe(at);
    const again = await post({ km: 20, source: "manuel", at, clientId: "client-id-0001", announce: false });
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect(await prisma.roadbookCheckin.count({ where: { roadbookId, clientId: "client-id-0001" } })).toBe(1);
  });

  it("refuse une heure trop ancienne et ramène une heure future à maintenant", async () => {
    const old = await post({ km: 21, source: "manuel", at: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    expect(old.statusCode).toBe(400);
    const future = await post({ km: 22, source: "manuel", at: new Date(Date.now() + 3600_000).toISOString(), announce: false });
    expect(new Date(future.json().checkin.at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("annonce un pointage différé comme tel, sans météo « maintenant »", async () => {
    sent = [];
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await post({ km: 30, source: "manuel", at: new Date(Date.now() - 2 * 3600_000).toISOString(), clientId: "client-id-0002" });
    await vi.waitFor(() => expect(sent.some((m) => m.chatId === CHANNEL)).toBe(true));
    const text = sent.find((m) => m.chatId === CHANNEL)!.text;
    expect(text).toContain("envoyé avec retard");
    expect(text).not.toContain("<b>Maintenant</b>");
  });

  it("envoie une alerte de barrière dépassée à part, une seule fois", async () => {
    // Départ il y a 5 h : CP1 (km 50) a fermé depuis longtemps, on pointe au km 10.
    sent = [];
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await post({ km: 10, source: "manuel" });
    await vi.waitFor(() => expect(sent.some((m) => m.text.includes("Barrière horaire dépassée"))).toBe(true));
    sent = [];
    await prisma.roadbook.update({ where: { id: roadbookId }, data: { lastAnnouncedAt: null } });
    await post({ km: 11, source: "manuel" });
    await vi.waitFor(() => expect(sent.some((m) => m.chatId === CHANNEL)).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.some((m) => m.text.includes("Barrière horaire dépassée"))).toBe(false);
  });

  describe("alertes proactives", () => {
    it("signale le silence puis le contrôle fermé, sans répéter", async () => {
      await prisma.roadbookAlert.deleteMany({});
      await prisma.roadbookCheckin.deleteMany({ where: { roadbookId } });
      await prisma.roadbookCheckin.create({ data: { roadbookId, km: 30, source: "manuel", at: new Date(Date.now() - 4 * 3600_000) } });
      sent = [];
      const n = await alertsLib.checkRoadbookAlerts();
      expect(n).toBe(2);
      expect(sent.some((m) => m.text.includes("Pas de nouveau pointage depuis"))).toBe(true);
      const closed = sent.find((m) => m.text.includes("a fermé à"));
      expect(closed?.text).toContain("CP1 Bourg");
      sent = [];
      expect(await alertsLib.checkRoadbookAlerts()).toBe(0);
      expect(sent).toEqual([]);
    });

    it("ne dit rien quand le randonneur pointe régulièrement et reste dans les temps", async () => {
      await prisma.roadbookAlert.deleteMany({});
      await prisma.roadbookCheckin.deleteMany({ where: { roadbookId } });
      await prisma.roadbook.update({ where: { id: roadbookId }, data: { startAt: new Date(Date.now() - 2 * 3600_000) } });
      await prisma.roadbookCheckin.create({ data: { roadbookId, km: 40, source: "manuel", at: new Date(Date.now() - 10 * 60_000) } });
      sent = [];
      expect(await alertsLib.checkRoadbookAlerts()).toBe(0);
    });
  });
});

describe("Surveillance du parcours officiel", () => {
  const pending = `<html><body><main><p>Retrouvez bientôt tous les liens vers les fichiers GPX du parcours</p></main></body></html>`;
  const published = `<html><body><main><p>Fichiers GPX</p><a href="https://www.paris-brest-paris.org/wp-content/uploads/pbp2027.gpx">GPX</a></main></body></html>`;

  it("analyse la page : mention « bientôt » et liens GPX", () => {
    expect(watchLib.analyzeRoutePage(pending)).toMatchObject({ routePending: true, routeLinks: [] });
    expect(watchLib.analyzeRoutePage(published)).toMatchObject({ routePending: false, routeLinks: ["https://www.paris-brest-paris.org/wp-content/uploads/pbp2027.gpx"] });
  });

  it("ne notifie pas à la première lecture, ni tant que rien ne change, puis prévient à la parution", async () => {
    const admin = await prisma.user.create({ data: { email: `admin-${Date.now()}@example.com`, passwordHash: "x", prenom: "Admin", isAdmin: true } });
    routePage = pending;
    expect((await watchLib.checkOfficialRoute()).notified).toBe(false);
    expect((await watchLib.checkOfficialRoute()).notified).toBe(false);
    expect((await watchLib.officialRouteState())?.pending).toBe(true);
    sent = [];
    routePage = published;
    const r = await watchLib.checkOfficialRoute();
    expect(r.notified).toBe(true);
    expect(sent.find((m) => m.chatId === NEWS)?.text).toContain("pbp2027.gpx");
    expect(await prisma.notification.count({ where: { userId: admin.id, kind: "pbp_route" } })).toBe(1);
    expect((await watchLib.officialRouteState())?.pending).toBe(false);
    // Pas de seconde notification pour le même état.
    expect((await watchLib.checkOfficialRoute()).notified).toBe(false);
  });
});
