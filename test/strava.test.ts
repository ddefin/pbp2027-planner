import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-strava.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let metrics: typeof import("../src/lib/stravaMetrics.js");
let coach: typeof import("../src/lib/stravaCoach.js");
let strava: typeof import("../src/lib/strava.js");
let reports: typeof import("../src/lib/coachReports.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const DAY = 86_400_000;
const today = new Date("2027-03-10T12:00:00Z"); // mercredi
const act = (daysAgo: number, o: Partial<import("../src/lib/stravaMetrics.js").ActivityInput> = {}) => ({
  startLocal: new Date(Date.UTC(2027, 2, 10) - daysAgo * DAY + 8 * 3600_000),
  movingSec: 3 * 3600, distanceM: 70_000, elevationM: 600, avgHr: 130, avgWatts: null, weightedWatts: null, avgSpeedMs: 6.5, load: 120, zone: 2, ...o,
});
const prefs = { profile: "endurance" as const, tone: "bienveillant" as const, metrics: ["hr", "elevation"] as ("hr" | "elevation")[], goal: null };

describe("Calculs d'entraînement", () => {
  const s = { ftp: 250, maxHr: 190, hrZones: [[0, 114], [115, 133], [134, 152], [153, 171], [172, -1]] as [number, number][] };

  it("estime la charge : 1 h au seuil de puissance = 100", () => {
    expect(metrics.estimateLoad({ movingSec: 3600, avgHr: null, avgWatts: null, weightedWatts: 250 }, s)).toBe(100);
    expect(metrics.estimateLoad({ movingSec: 7200, avgHr: null, avgWatts: null, weightedWatts: 125 }, s)).toBe(50); // 2 h à 50 % : 2×100×0,25
    const hr = metrics.estimateLoad({ movingSec: 3600, avgHr: 171, avgWatts: null, weightedWatts: null }, s); // 171 = 90 % de 190
    expect(hr).toBe(100);
    expect(metrics.estimateLoad({ movingSec: 3600, avgHr: null, avgWatts: null, weightedWatts: null }, { ftp: null, maxHr: null, hrZones: null })).toBeCloseTo(42.3, 1);
    expect(metrics.estimateLoad({ movingSec: 0, avgHr: 150, avgWatts: null, weightedWatts: null }, s)).toBe(0);
  });

  it("classe la zone d'après la FC (zones Strava) puis la puissance, sinon null", () => {
    expect(metrics.estimateZone({ avgHr: 125, avgWatts: null, weightedWatts: null }, s)).toBe(2);
    expect(metrics.estimateZone({ avgHr: 180, avgWatts: null, weightedWatts: null }, s)).toBe(5);
    expect(metrics.estimateZone({ avgHr: null, avgWatts: 140, weightedWatts: null }, s)).toBe(2); // 56 % du FTP
    expect(metrics.estimateZone({ avgHr: null, avgWatts: null, weightedWatts: null }, s)).toBeNull();
  });

  it("agrège volumes, semaines, forme et intensités", () => {
    const list = [act(0), act(2), act(9), act(30), act(100, { zone: 4 })];
    expect(metrics.sumVolume(metrics.lastDays(list, 7, today)).rides).toBe(2);
    expect(metrics.sumVolume(metrics.lastDays(list, 30, today)).rides).toBe(3);
    const weeks = metrics.weeklySeries(list, 8, today);
    expect(weeks).toHaveLength(8);
    expect(weeks[7].weekStart).toBe("2027-03-08"); // lundi de la semaine en cours
    expect(weeks[7].rides).toBe(2);
    const f = metrics.fitness(list, today);
    expect(f.acute).toBe(240);
    expect(f.chronic).toBe(Math.round((120 * 3) / 4)); // 28 jours : 3 sorties
    expect(f.acwr).toBeCloseTo(240 / 90, 2);
    const share = metrics.intensityShare([act(1, { zone: 2 }), act(2, { zone: 3 }), act(3, { zone: 5 }), act(4, { zone: null })]);
    expect(share).toMatchObject({ low: 33, mid: 33, high: 33 });
    expect(share.coveredSeconds).toBe(3 * 3 * 3600);
  });
});

describe("Moteur du Coach", () => {
  // 3 semaines régulières (3 sorties de 120/semaine) puis une semaine plus chargée.
  const base = [...[8, 10, 12, 15, 17, 19, 22, 24, 26].map((d) => act(d))];

  it("détecte un surmenage quand la charge de la semaine explose", () => {
    const list = [...base, act(0, { load: 300 }), act(1, { load: 300 }), act(3, { load: 300 })];
    const r = coach.analyze(list, prefs, today);
    expect(r.headline.level).toBe("alerte");
    expect(r.diagnostics[0].title).toContain("surmenage");
    expect(r.advice[0]).toMatch(/repos|facile/i);
    expect(r.facts.volumeChangePct).toBeGreaterThan(40);
  });

  it("signale une hausse > 15 % sans crier au surmenage", () => {
    const list = [...base, act(0, { load: 160 }), act(2, { load: 120 }), act(4, { load: 120 })]; // 400 vs 360 : +11 %... 
    const up = [...base, act(0, { load: 200 }), act(2, { load: 140 }), act(4, { load: 120 })]; // 460 vs 360 : +28 %
    expect(coach.analyze(list, prefs, today).headline.level).toBe("ok");
    expect(coach.analyze(up, prefs, today).headline.level).toBe("attention");
  });

  it("note la baisse de charge et donne le bon félicitations pour l'endurance", () => {
    const calm = coach.analyze([...base, act(0, { load: 20, movingSec: 1800 })], prefs, today);
    expect(calm.headline.level).toBe("info");
    const solid = coach.analyze([...base, act(0), act(2), act(4)], prefs, today);
    expect(solid.balance?.level).toBe("ok");
    expect(solid.balance?.text).toMatch(/endurance/);
    const grey = coach.analyze([...base.map((a) => ({ ...a, zone: 3 })), act(0, { zone: 3 }), act(2, { zone: 3 }), act(4, { zone: 3 })], prefs, today);
    expect(grey.balance?.title).toContain("zone grise");
  });

  it("adapte le ton, les métriques et le profil, avec 3 conseils maximum", () => {
    const list = [...base, act(0), act(2), act(4)];
    const direct = coach.analyze(list, { ...prefs, tone: "direct" }, today);
    const technique = coach.analyze(list, { ...prefs, tone: "technique" }, today);
    expect(direct.headline.text).not.toBe(technique.headline.text);
    expect(technique.headline.text).toContain("ACWR");
    const m = coach.analyze(list.map((a) => ({ ...a, weightedWatts: 180 })), { ...prefs, metrics: ["power", "speed"] }, today);
    expect(m.metrics.map((x) => x.title)).toEqual(["Puissance", "Vitesse"]);
    const endur = coach.analyze(list, { ...prefs, goal: "BRM 400" }, today);
    expect(endur.advice.length).toBeLessThanOrEqual(3);
    expect(endur.advice.join(" ")).toMatch(/glucides|eau/);
    expect(coach.analyze(list, { ...prefs, profile: "forme" }, today).advice.join(" ")).toMatch(/régularité/);
  });

  it("reste prudent sans données récentes", () => {
    const r = coach.analyze([], prefs, today);
    expect(r.headline.level).toBe("info");
    expect(r.advice).toHaveLength(1);
    expect(coach.analyze([act(200)], prefs, today).headline.level).toBe("info");
  });
});

// ─── API ───

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let sentTelegram: string[] = [];
let athleteStatus = 200;
let tokenExpiresAt = Math.floor(Date.now() / 1000) + 6 * 3600;
let remoteActivities: Record<string, unknown>[] = [];
let tokenExchangeStatus = 200;

const localIso = (daysAgo: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - daysAgo * DAY + 8 * 3600_000).toISOString().replace(".000Z", "Z");
const remote = (id: number, daysAgo: number, o: Record<string, unknown> = {}) => ({
  id, name: `Sortie ${id}`, sport_type: "Ride", start_date: localIso(daysAgo), start_date_local: localIso(daysAgo),
  distance: 80_000, moving_time: 3 * 3600, total_elevation_gain: 700, average_heartrate: 135, max_heartrate: 172, average_speed: 7.4, ...o,
});

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.PUBLIC_URL = "https://pbp.example";
  process.env.STRAVA_CLIENT_ID = "12345";
  process.env.STRAVA_CLIENT_SECRET = "secret-strava";
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "verify-me";
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  metrics = await import("../src/lib/stravaMetrics.js");
  coach = await import("../src/lib/stravaCoach.js");
  strava = await import("../src/lib/strava.js");
  reports = await import("../src/lib/coachReports.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  calls = [];
  sentTelegram = [];
  athleteStatus = 200;
  tokenExchangeStatus = 200;
  tokenExpiresAt = Math.floor(Date.now() / 1000) + 6 * 3600;
  remoteActivities = [remote(1, 1), remote(2, 3), remote(3, 8), remote(4, 40), remote(9, 2, { sport_type: "Run" })];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (u.includes("api.telegram.org")) {
        sentTelegram.push(JSON.parse(String(init?.body)).text);
        return json({ ok: true, result: {} });
      }
      if (u.endsWith("/oauth/token") && tokenExchangeStatus !== 200) return json({ message: "Forbidden", errors: [{ resource: "Application", field: "athlete_limit", code: "exceeded" }] }, tokenExchangeStatus);
      if (u.endsWith("/oauth/token")) {
        const body = new URLSearchParams(String(init?.body));
        return json({ access_token: body.get("grant_type") === "refresh_token" ? "access-refreshed" : "access-1", refresh_token: body.get("grant_type") === "refresh_token" ? "refresh-2" : "refresh-1", expires_at: tokenExpiresAt, athlete: { id: 777, firstname: "Didier", lastname: "D.", profile: "https://img.example/p.jpg" } });
      }
      if (u.endsWith("/oauth/deauthorize")) return json({ access_token: "x" });
      if (u.endsWith("/api/v3/athlete")) return athleteStatus === 200 ? json({ ftp: 230, firstname: "Didier", lastname: "D." }) : json({ message: "Authorization Error" }, athleteStatus);
      if (u.includes("/athlete/zones")) return json({ heart_rate: { zones: [{ min: 0, max: 114 }, { min: 115, max: 133 }, { min: 134, max: 152 }, { min: 153, max: 171 }, { min: 172, max: -1 }] } });
      if (u.includes("/athlete/activities")) return json(u.includes("page=1") ? remoteActivities : []);
      if (/\/activities\/\d+/.test(u)) return json(remoteActivities.find((a) => String(a.id) === u.split("/").pop()) ?? { message: "nf" }, remoteActivities.some((a) => String(a.id) === u.split("/").pop()) ? 200 : 404);
      if (u.includes("push_subscriptions")) return init?.method === "POST" ? json({ id: 1 }, 201) : json([]);
      if (u.includes("mcp.strava.com")) return new Response("unauthorized", { status: 401 });
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("API Strava", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    server = buildServer();
    const email = `strava-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  });

  const get = (url: string, withCookie = true) => server.inject({ method: "GET", url, headers: withCookie ? { cookie } : {} });
  const callback = (qs: string) => server.inject({ method: "GET", url: `/api/strava/callback?${qs}` });

  it("exige une session et propose le bon lien d'autorisation", async () => {
    expect((await get("/api/strava/status", false)).statusCode).toBe(401);
    const status = (await get("/api/strava/status")).json();
    expect(status.missing).toEqual([]);
    expect(status).toMatchObject({ configured: true, connected: false, redirectUri: "https://pbp.example/api/strava/callback" });
    const { url } = (await get("/api/strava/connect")).json();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("read,activity:read_all,profile:read_all");
    expect(u.searchParams.get("client_id")).toBe("12345");
    expect(u.searchParams.get("redirect_uri")).toBe("https://pbp.example/api/strava/callback");
    expect(strava.readState(u.searchParams.get("state")!)).toBe(userId);
  });

  it("refuse un état falsifié, expiré, un refus ou des autorisations incomplètes", async () => {
    expect(strava.readState("n.importe.quoi")).toBeNull();
    const s = strava.makeState(userId);
    expect(strava.readState(s.replace(userId, "autre"))).toBeNull();
    expect(strava.readState(s, Date.now() + 11 * 60_000)).toBeNull();
    expect((await callback("error=access_denied")).headers.location).toBe("/profil?strava=denied#strava");
    expect((await callback(`code=abc&state=forge`)).headers.location).toBe("/profil?strava=invalid#strava");
    expect((await callback(`code=abc&state=${encodeURIComponent(s)}&scope=read`)).headers.location).toBe("/profil?strava=scope#strava");
    expect(await prisma.stravaAccount.count()).toBe(0);
  });

  it("prévient l'utilisateur et les admins quand l'application Strava a atteint sa limite de sportifs", async () => {
    const admin = await prisma.user.create({ data: { email: `adm-lim-${Date.now()}@example.com`, passwordHash: "x", prenom: "Admin", isAdmin: true } });
    tokenExchangeStatus = 403;
    const s = strava.makeState(userId);
    const res = await callback(`code=abc&state=${encodeURIComponent(s)}&scope=read,activity:read_all,profile:read_all`);
    expect(res.headers.location).toBe("/profil?strava=limit#strava");
    expect(await prisma.stravaAccount.count({ where: { userId } })).toBe(0);
    const n = await prisma.notification.findFirst({ where: { userId: admin.id, kind: "strava_limit" } });
    expect(n?.message).toContain("limite de sportifs");
    expect(n?.message).toContain("Didier");
  });

  it("connecte le compte, chiffre les jetons et synchronise les sorties à vélo", async () => {
    const s = strava.makeState(userId);
    const res = await callback(`code=abc&state=${encodeURIComponent(s)}&scope=read,activity:read_all,profile:read_all`);
    expect(res.headers.location).toBe("/profil?strava=ok#strava");
    const acc = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId } });
    expect(acc.athleteId).toBe("777");
    expect(acc.accessToken).not.toContain("access-1"); // chiffré au repos
    expect(acc.refreshToken).not.toContain("refresh-1");
    await vi.waitFor(async () => expect(await prisma.stravaActivity.count({ where: { userId } })).toBe(4), { timeout: 3000 });
    expect(await prisma.stravaActivity.count({ where: { sportType: "Run" } })).toBe(0); // course à pied ignorée
    const synced = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId } });
    expect(synced.ftp).toBe(230);
    expect(synced.maxHr).toBeGreaterThanOrEqual(172);
    expect(synced.lastSyncError).toBeNull();
    const first = await prisma.stravaActivity.findUniqueOrThrow({ where: { id: "1" } });
    expect(first.zone).toBe(3); // FC moyenne 135 : zone 3 des zones Strava
    expect(first.load).toBeGreaterThan(0);
    expect((await get("/api/strava/status")).json()).toMatchObject({ connected: true, account: { athleteName: "Didier D.", scopeOk: true } });
  });

  it("calcule le tableau de bord et l'analyse du Coach", async () => {
    const d = (await get("/api/strava/dashboard")).json();
    expect(d.kpis.d7.rides).toBe(2);
    expect(d.kpis.d30.rides).toBe(3);
    expect(d.kpis.d7.km).toBeCloseTo(160, 0);
    expect(d.weekly).toHaveLength(8);
    expect(d.fitness).toHaveProperty("acwr");
    expect(d.intensity.month).toHaveProperty("low");
    expect(d.coach.headline.text.length).toBeGreaterThan(5);
    expect(d.coach.advice.length).toBeGreaterThanOrEqual(1);
    expect(d.recent).toHaveLength(4);
    await prisma.stravaAccount.deleteMany({ where: { userId } });
    expect((await get("/api/strava/dashboard")).statusCode).toBe(404);
    await prisma.stravaAccount.create({ data: { userId, athleteId: "777", athleteName: "Didier D.", accessToken: (await import("../src/lib/secretCrypto.js")).encryptSecret("access-1"), refreshToken: (await import("../src/lib/secretCrypto.js")).encryptSecret("refresh-1"), expiresAt: new Date(Date.now() + 6 * 3600_000), scope: "read,activity:read_all,profile:read_all" } });
  });

  it("renouvelle automatiquement le jeton expiré et garde le nouveau refresh_token", async () => {
    await prisma.stravaAccount.update({ where: { userId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    tokenExpiresAt = Math.floor(Date.now() / 1000) + 6 * 3600;
    expect(await strava.validAccessToken(userId)).toBe("access-refreshed");
    const refreshCall = calls.find((c) => c.url.endsWith("/oauth/token"))!;
    const body = new URLSearchParams(String(refreshCall.init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    const { decryptSecret } = await import("../src/lib/secretCrypto.js");
    const acc = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId } });
    expect(decryptSecret(acc.refreshToken)).toBe("refresh-2");
    expect(acc.expiresAt.getTime()).toBeGreaterThan(Date.now() + 5 * 3600_000);
    calls = [];
    expect(await strava.validAccessToken(userId)).toBe("access-refreshed"); // encore valide : pas de nouvel appel
    expect(calls).toHaveLength(0);
  });

  it("enregistre et relit les préférences du Coach, en refusant les valeurs invalides", async () => {
    expect((await get("/api/strava/coach-prefs")).json().prefs).toMatchObject({ profile: "endurance", tone: "bienveillant", frequency: "hebdo" });
    const payload = { profile: "performance", tone: "technique", frequency: "activite", metrics: ["power", "speed", "power"], goal: "  PBP 2027  " };
    expect((await server.inject({ method: "PUT", url: "/api/strava/coach-prefs", headers: { cookie }, payload })).statusCode).toBe(200);
    expect((await get("/api/strava/coach-prefs")).json().prefs).toEqual({ profile: "performance", tone: "technique", frequency: "activite", metrics: ["power", "speed"], goal: "PBP 2027" });
    for (const bad of [{ ...payload, profile: "gourou" }, { ...payload, metrics: [] }, { ...payload, frequency: "toutes-les-minutes" }]) {
      expect((await server.inject({ method: "PUT", url: "/api/strava/coach-prefs", headers: { cookie }, payload: bad })).statusCode).toBe(400);
    }
  });

  it("vérifie l'abonnement webhook et ne répond qu'avec le bon jeton", async () => {
    expect((await get("/api/strava/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=abc", false)).statusCode).toBe(403);
    const ok = await get("/api/strava/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc", false);
    expect(ok.json()).toEqual({ "hub.challenge": "abc" });
    expect(await strava.ensureWebhookSubscription()).toBe("created");
    const post = calls.find((c) => c.url.endsWith("/push_subscriptions") && c.init?.method === "POST")!;
    expect(new URLSearchParams(String(post.init?.body)).get("callback_url")).toBe("https://pbp.example/api/strava/webhook");
  });

  it("synchronise une activité créée par webhook et envoie le bilan « après chaque sortie »", async () => {
    remoteActivities.push(remote(50, 0, { name: "Sortie du jour" }));
    const res = await server.inject({ method: "POST", url: "/api/strava/webhook", payload: { object_type: "activity", object_id: 50, aspect_type: "create", owner_id: 777 } });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(async () => expect(await prisma.stravaActivity.count({ where: { id: "50" } })).toBe(1), { timeout: 3000 });
    await vi.waitFor(async () => expect(await prisma.notification.count({ where: { userId, kind: "coach" } })).toBe(1), { timeout: 3000 });
    // Le même événement rejoué ne renvoie pas un second bilan.
    await server.inject({ method: "POST", url: "/api/strava/webhook", payload: { object_type: "activity", object_id: 50, aspect_type: "create", owner_id: 777 } });
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { userId, kind: "coach" } })).toBe(1);
    // Suppression côté Strava.
    await server.inject({ method: "POST", url: "/api/strava/webhook", payload: { object_type: "activity", object_id: 50, aspect_type: "delete", owner_id: 777 } });
    await vi.waitFor(async () => expect(await prisma.stravaActivity.count({ where: { id: "50" } })).toBe(0), { timeout: 3000 });
    // Propriétaire inconnu : ignoré sans erreur.
    expect((await server.inject({ method: "POST", url: "/api/strava/webhook", payload: { object_type: "activity", object_id: 51, aspect_type: "create", owner_id: 999 } })).statusCode).toBe(200);
  });

  it("n'efface rien sur un faux événement de déautorisation, mais efface sur un vrai", async () => {
    const deauth = { object_type: "athlete", object_id: 777, aspect_type: "update", owner_id: 777, updates: { authorized: "false" } };
    athleteStatus = 200; // le jeton est toujours valable : l'événement est forgé
    await server.inject({ method: "POST", url: "/api/strava/webhook", payload: deauth });
    await new Promise((r) => setTimeout(r, 400));
    expect(await prisma.stravaAccount.count({ where: { userId } })).toBe(1);
    athleteStatus = 401; // vraie déautorisation
    await server.inject({ method: "POST", url: "/api/strava/webhook", payload: deauth });
    await vi.waitFor(async () => expect(await prisma.stravaAccount.count({ where: { userId } })).toBe(0), { timeout: 3000 });
    expect(await prisma.stravaActivity.count({ where: { userId } })).toBe(0);
  });

  it("déconnecte proprement : révocation chez Strava puis effacement des données locales", async () => {
    athleteStatus = 200;
    const { encryptSecret } = await import("../src/lib/secretCrypto.js");
    await prisma.stravaAccount.create({ data: { userId, athleteId: "777", athleteName: "Didier D.", accessToken: encryptSecret("access-1"), refreshToken: encryptSecret("refresh-1"), expiresAt: new Date(Date.now() + 6 * 3600_000), scope: "read,activity:read_all" } });
    await prisma.stravaActivity.create({ data: { id: "900", userId, name: "x", sportType: "Ride", startDate: new Date(), startLocal: new Date(), distanceM: 1, movingSec: 1, elevationM: 0, load: 1 } });
    const res = await server.inject({ method: "POST", url: "/api/strava/disconnect", headers: { cookie } });
    expect(res.json()).toEqual({ revoked: true });
    const dea = calls.find((c) => c.url.endsWith("/oauth/deauthorize"))!;
    expect(new URLSearchParams(String(dea.init?.body)).get("access_token")).toBe("access-1");
    expect(await prisma.stravaAccount.count({ where: { userId } })).toBe(0);
    expect(await prisma.stravaActivity.count({ where: { userId } })).toBe(0);
  });

  it("teste la joignabilité du serveur MCP Strava (401 = joignable)", async () => {
    const res = await server.inject({ method: "POST", url: "/api/strava/mcp-test", headers: { cookie } });
    expect(res.json()).toMatchObject({ reachable: true, status: 401 });
    expect(res.json().message).toContain("authentification requise");
  });

  it("envoie le bilan hebdomadaire le dimanche soir, une seule fois", async () => {
    const { encryptSecret } = await import("../src/lib/secretCrypto.js");
    await prisma.stravaAccount.create({ data: { userId, athleteId: "777", athleteName: "Didier D.", accessToken: encryptSecret("a"), refreshToken: encryptSecret("r"), expiresAt: new Date(Date.now() + 6 * 3600_000), scope: "read,activity:read_all" } });
    await prisma.stravaActivity.create({ data: { id: "901", userId, name: "x", sportType: "Ride", startDate: new Date(), startLocal: new Date(), distanceM: 80000, movingSec: 10800, elevationM: 500, load: 100 } });
    await prisma.coachPrefs.update({ where: { userId }, data: { frequency: "hebdo", lastReportKey: null } });
    const before = await prisma.notification.count({ where: { userId, kind: "coach" } });
    expect(await reports.sendWeeklyReports(new Date("2027-03-07T16:00:00Z"))).toBe(0); // dimanche 17 h Paris : trop tôt
    expect(await reports.sendWeeklyReports(new Date("2027-03-10T20:00:00Z"))).toBe(0); // mercredi
    expect(await reports.sendWeeklyReports(new Date("2027-03-07T18:30:00Z"))).toBe(1); // dimanche 19 h 30 Paris
    expect(await reports.sendWeeklyReports(new Date("2027-03-07T19:30:00Z"))).toBe(0); // déjà envoyé cette semaine
    expect(await prisma.notification.count({ where: { userId, kind: "coach" } })).toBe(before + 1);
    const n = await prisma.notification.findFirst({ where: { userId, kind: "coach" }, orderBy: { createdAt: "desc" } });
    expect(n?.message).toMatch(/^🚴 Bilan du Coach/);
    expect(n?.message).not.toMatch(/[<>&]/);
  });
});
