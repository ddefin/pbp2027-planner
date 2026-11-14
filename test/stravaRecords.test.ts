import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Strava : records personnels, défis brevets, trophées de segments (KOM/QOM, Top 10, PR)
// et lecture des segments par petits lots (quota Strava).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-strava-records.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let rec: typeof import("../src/lib/stravaRecords.js");
let strava: typeof import("../src/lib/strava.js");
let crypto_: typeof import("../src/lib/secretCrypto.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const d = (iso: string) => new Date(`${iso}T08:00:00Z`);
const ride = (id: string, iso: string, km: number, o: Partial<import("../src/lib/stravaRecords.js").RecordActivity & { elapsedSec: number }> = {}) => ({
  id, name: `Sortie ${id}`, startLocal: d(iso), distanceM: km * 1000, movingSec: (km / 25) * 3600, elevationM: km * 8, maxSpeedMs: 15, ...o,
});

let calls: string[] = [];
let quotaAfter = Infinity;
let usageHeader: string | null = null; // ex. "70,100" : consommation 15 min / jour simulée
// Historique distant simulé, du plus récent au plus ancien (start_date décroissante).
let history: { id: string; start: string; achievements: number; sport?: string }[] = [];
const effortsFor = (id: string) => [
  { id: `${id}-1`, elapsed_time: 300, start_date_local: "2027-05-01T09:00:00Z", kom_rank: 1, pr_rank: 1, segment: { id: 11, name: "Côte de la Madeleine", distance: 2100, average_grade: 6.2, climb_category: 1, city: "Rambouillet" } },
  { id: `${id}-2`, elapsed_time: 120, start_date_local: "2027-05-01T09:10:00Z", kom_rank: 4, pr_rank: null, segment: { id: 12, name: "Sprint du stade", distance: 600, average_grade: 0.5, climb_category: 0, city: null } },
  { id: `${id}-3`, elapsed_time: 400, start_date_local: "2027-05-01T09:20:00Z", kom_rank: null, pr_rank: 1, segment: { id: 13, name: "Mur de Bourg", distance: 900, average_grade: 9, climb_category: 2, city: "Bourg" } },
  { id: `${id}-4`, elapsed_time: 500, start_date_local: "2027-05-01T09:30:00Z", kom_rank: null, pr_rank: null, segment: { id: 14, name: "Plat", distance: 3000 } },
];

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.STRAVA_CLIENT_ID = "12345";
  process.env.STRAVA_CLIENT_SECRET = "secret-strava";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  rec = await import("../src/lib/stravaRecords.js");
  strava = await import("../src/lib/strava.js");
  crypto_ = await import("../src/lib/secretCrypto.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  calls = [];
  quotaAfter = Infinity;
  usageHeader = null;
  strava?.resetQuotaForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      const headers: Record<string, string> = usageHeader ? { "X-RateLimit-Usage": usageHeader, "X-RateLimit-Limit": "100,1000" } : {};
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
      if (u.includes("/athlete/activities?before=")) {
        const before = Number(new URL(u).searchParams.get("before")) * 1000;
        const per = Number(new URL(u).searchParams.get("per_page"));
        const page = history.filter((h) => Date.parse(h.start) < before).slice(0, per);
        return json(page.map((h) => ({ id: h.id, name: `Ancienne ${h.id}`, sport_type: h.sport ?? "Ride", start_date: h.start, start_date_local: h.start, distance: 90000, moving_time: 12000, total_elevation_gain: 800, achievement_count: h.achievements })));
      }
      const m = u.match(/\/activities\/(\w+)$/);
      if (m) {
        if (calls.filter((c) => /\/activities\/\w+$/.test(c)).length > quotaAfter) return json({ message: "Rate Limit Exceeded" }, 429);
        if (m[1] === "gone") return json({ message: "Record Not Found" }, 404);
        return json({ id: m[1], name: `Sortie ${m[1]}`, sport_type: "Ride", start_date: "2027-05-01T07:00:00Z", start_date_local: "2027-05-01T09:00:00Z", distance: 120000, moving_time: 18000, elapsed_time: 20000, total_elevation_gain: 900, achievement_count: 3, pr_count: 2, max_speed: 16, segment_efforts: effortsFor(m[1]) });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Records et défis brevets", () => {
  const list = [
    ride("a", "2027-04-01", 210, { movingSec: 8 * 3600, elapsedSec: 12 * 3600 }), // 17,5 km/h brut
    ride("b", "2027-04-02", 60, { maxSpeedMs: 18 }),
    ride("c", "2027-04-03", 90, { elevationM: 2100 }),
    ride("d", "2027-04-10", 310, { movingSec: 13 * 3600, elapsedSec: 18 * 3600 }),
    ride("e", "2027-05-20", 40, { movingSec: 3600 }), // 40 km/h mais moins de 50 km : pas de record de moyenne
  ];

  it("trouve plus longue sortie, D+, durée, moyenne, vitesse max, semaine, mois et série", () => {
    const r = Object.fromEntries(rec.personalRecords(list).map((x) => [x.key, x]));
    expect(r.distance).toMatchObject({ value: 310, activityId: "d", date: "2027-04-10" });
    expect(r.elevation).toMatchObject({ value: 2480, activityId: "d" }); // 310 × 8
    expect(r.duration.value).toBe(13);
    expect(r.avg.activityId).not.toBe("e");
    expect(r.vmax).toMatchObject({ value: 64.8, activityId: "b" });
    expect(r.week).toMatchObject({ value: 360, date: "2027-03-29", until: "2027-04-04" }); // lundi 29 mars → dim 4 avril
    expect(r.month).toMatchObject({ value: 670, date: "2027-04-01" });
    expect(r.streak).toMatchObject({ value: 3, date: "2027-04-01", until: "2027-04-03" });
    expect(rec.personalRecords([])).toEqual([]);
  });

  it("valide les paliers, compte les 200 km et calcule la moyenne brevet pauses comprises", () => {
    const c = rec.brevetChallenges(list);
    expect(c.steps.map((s) => s.done)).toEqual([true, true, false, false, false]);
    expect(c.steps[0]).toMatchObject({ activityId: "a", date: "2027-04-01" }); // premier 200 atteint
    expect(c.steps[1]).toMatchObject({ activityId: "d" });
    expect(c.rides200).toBe(2);
    expect(c.best200).toMatchObject({ activityId: "a", kmh: 17.5 });
    expect(c.bestMonth).toMatchObject({ month: "2027-04", km: 670, pct: 56 });
  });

  it("classe les trophées : KOM d'abord, un segment une seule fois, PR de la saison", () => {
    const base = { activityId: "x", distanceM: 1000, avgGradePct: 5, climbCategory: 0, city: null, elapsedSec: 100 };
    const efforts = [
      { ...base, id: "1", segmentId: "s1", segmentName: "A", startLocal: d("2027-03-01"), prRank: 1, komRank: 3 },
      { ...base, id: "2", segmentId: "s1", segmentName: "A", startLocal: d("2027-04-01"), prRank: 1, komRank: 1 }, // meilleur rang : remplace le 3e
      { ...base, id: "3", segmentId: "s2", segmentName: "B", startLocal: d("2027-02-01"), prRank: null, komRank: 7 },
      { ...base, id: "4", segmentId: "s3", segmentName: "C", startLocal: d("2027-05-01"), prRank: 1, komRank: null },
      { ...base, id: "5", segmentId: "s4", segmentName: "D", startLocal: d("2026-11-01"), prRank: 1, komRank: null }, // saison précédente
    ];
    const t = rec.trophies(efforts, new Date("2027-01-01T00:00:00Z"));
    expect(t).toMatchObject({ kom: 1, top10: 1, prSeason: 2 });
    expect(t.list.map((x) => `${x.segmentName}:${x.kind}:${x.rank}`)).toEqual(["A:kom:1", "B:top10:7", "C:pr:1", "A:pr:1"]); // A : KOM et PR de la saison
  });
});

describe("Lecture des segments et API", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    server = buildServer();
    const email = `strava-rec-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    await prisma.stravaAccount.create({
      data: {
        userId, athleteId: "777", athleteName: "Didier", scope: "read,activity:read_all,profile:read_all",
        accessToken: crypto_.encryptSecret("access-ok"), refreshToken: crypto_.encryptSecret("refresh-ok"), expiresAt: new Date(Date.now() + 3 * 3600_000),
        allTimeStats: JSON.stringify({ biggestRideM: 612000, biggestClimbM: 1850, all: { count: 900, distanceM: 52_000_000, movingSec: 7_000_000, elevationM: 410_000 } }),
      },
    });
    const mk = (id: string, iso: string, km: number, achievements: number) =>
      prisma.stravaActivity.create({ data: { id, userId, name: `Sortie ${id}`, sportType: "Ride", startDate: d(iso), startLocal: d(iso), distanceM: km * 1000, movingSec: 3600 * (km / 25), elapsedSec: 3600 * (km / 20), elevationM: km * 7, load: 100, achievementCount: achievements } });
    for (let i = 0; i < 5; i++) await mk(`r${i}`, `2027-05-0${i + 1}`, 80 + i * 40, 2);
    await mk("plain", "2027-04-01", 50, 0);
    await mk("gone", "2027-03-01", 30, 1);
  });

  it("lit le détail par lots, ne garde que les efforts marquants et s'arrête sur un 429", async () => {
    quotaAfter = 2; // 3e appel refusé
    const first = await strava.fetchSegmentDetails(userId, 10);
    expect(first).toMatchObject({ fetched: 2, throttled: true });
    expect(await prisma.stravaSegmentEffort.count({ where: { userId } })).toBe(6); // 3 marquants × 2 sorties ; « Plat » ignoré
    quotaAfter = Infinity;
    calls = [];
    const second = await strava.fetchSegmentDetails(userId, 2);
    expect(second).toMatchObject({ fetched: 2, remaining: 2, throttled: false }); // budget respecté
    expect(calls.filter((c) => /\/activities\//.test(c))).toHaveLength(2);
    const third = await strava.fetchSegmentDetails(userId, 10);
    expect(third.remaining).toBe(0); // « gone » (404) marquée lue, pas redemandée
    expect(calls.some((c) => c.endsWith("/activities/plain"))).toBe(false); // pas de trophée : pas d'appel
  });

  it("renvoie records, défis, trophées et avancement de l'analyse", async () => {
    const res = await server.inject({ method: "GET", url: "/api/strava/records", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.records.find((r: { key: string }) => r.key === "distance").value).toBe(240);
    expect(j.allTime.biggestRideM).toBe(612000);
    expect(j.challenges.steps[0].done).toBe(true);
    expect(j.trophies).toMatchObject({ kom: 1, top10: 1 }); // même segment sur 5 sorties : compté une fois
    expect(j.trophies.list[0]).toMatchObject({ kind: "kom", segmentName: "Côte de la Madeleine", city: "Rambouillet" });
    expect(j.segments).toMatchObject({ analysed: 6, total: 6 });
    expect((await server.inject({ method: "GET", url: "/api/strava/records" })).statusCode).toBe(401);
  });

  it("le webhook enregistre les segments sans requête en plus, la déconnexion les efface", async () => {
    calls = [];
    const r = await strava.syncOneActivity("777", "neuf", "create");
    expect(r?.created).toBe(true);
    expect(calls.filter((c) => /\/activities\//.test(c))).toHaveLength(1);
    expect(await prisma.stravaSegmentEffort.count({ where: { activityId: "neuf" } })).toBe(3);
    expect((await prisma.stravaActivity.findUniqueOrThrow({ where: { id: "neuf" } })).detailFetchedAt).not.toBeNull();
    await strava.purgeLocal(userId);
    expect(await prisma.stravaSegmentEffort.count({ where: { userId } })).toBe(0);
  });
});

describe("Rattrapage de tout l'historique", () => {
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({ data: { email: `hist-${tag}-${Date.now()}@example.com`, passwordHash: "x", prenom: tag } });
    await prisma.stravaAccount.create({
      data: { userId: u.id, athleteId: `a-${tag}-${Date.now()}`, athleteName: tag, scope: "read,activity:read_all", accessToken: crypto_.encryptSecret("t"), refreshToken: crypto_.encryptSecret("r"), expiresAt: new Date(Date.now() + 3600_000) },
    });
    // Une sortie récente déjà synchronisée : le rattrapage repart d'avant elle.
    await prisma.stravaActivity.create({ data: { id: `recent-${tag}`, userId: u.id, name: "Récente", sportType: "Ride", startDate: new Date("2026-10-01T08:00:00Z"), startLocal: new Date("2026-10-01T08:00:00Z"), distanceM: 50000, movingSec: 7200, elevationM: 300, load: 50 } });
    return u.id;
  };
  // 450 sorties de 2016 à 2025 (une sur trois à trophées) + une course à pied.
  const makeHistory = (prefix: string) =>
    Array.from({ length: 450 }, (_, i) => ({ id: `${prefix}${i}`, start: new Date(Date.UTC(2025, 8, 1) - i * 7 * 86_400_000).toISOString(), achievements: i % 3 === 0 ? 2 : 0, sport: i === 5 ? "Run" : "Ride" }));

  it("lit les pages vers le passé, s'arrête sur la dernière, puis analyse les segments anciens", async () => {
    const userId = await mkUser("hist1");
    history = makeHistory("h");
    let guard = 0;
    while (!(await prisma.stravaAccount.findUniqueOrThrow({ where: { userId } })).historyDoneAt && guard++ < 10) {
      const r = await strava.backfillHistory(userId, 4, () => false);
      expect(r.requests).toBeLessThanOrEqual(4); // budget respecté (1 page + segments)
    }
    const acc = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId } });
    expect(acc.historyDoneAt).not.toBeNull();
    expect(acc.firstRideAt!.toISOString().slice(0, 10)).toBe(history[449].start.slice(0, 10));
    expect(await prisma.stravaActivity.count({ where: { userId } })).toBe(1 + 449); // course à pied ignorée
    expect(calls.filter((c) => c.includes("before=")).length).toBe(3); // 200 + 200 + 50
    // Les pages suivantes ne relisent plus la liste : seulement les segments.
    calls = [];
    await strava.backfillHistory(userId, 10, () => false);
    expect(calls.some((c) => c.includes("before="))).toBe(false);
    expect(calls.filter((c) => /\/activities\/\w+$/.test(c))).toHaveLength(10);
  });

  it("partage le budget horaire entre les comptes et s'arrête quand le quota réel est trop haut", async () => {
    await prisma.stravaSegmentEffort.deleteMany({});
    await prisma.stravaActivity.deleteMany({});
    await prisma.stravaAccount.deleteMany({});
    const a = await mkUser("ha");
    const b = await mkUser("hb");
    history = makeHistory("x");
    calls = [];
    const used = await strava.backfillAll(12, () => false);
    expect(used).toBeLessThanOrEqual(12);
    const touched = (await prisma.stravaAccount.findMany({ where: { userId: { in: [a, b] } } })).filter((x) => x.historyBefore !== null);
    expect(touched).toHaveLength(2); // les deux comptes ont avancé

    // Consommation réelle à 70 % du quota de 15 min : rien de plus n'est demandé.
    usageHeader = "70,100";
    calls = [];
    await strava.backfillHistory(a, 10); // garde par défaut : quota réel
    const afterFirst = calls.length;
    expect(afterFirst).toBeLessThanOrEqual(1); // la 1re réponse révèle le quota, on s'arrête
    expect(strava.quotaUsage().short).toBeCloseTo(0.7);
    calls = [];
    expect(await strava.backfillAll(12)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("records et trophées sur tout l'historique, défis brevets sur 13 mois", async () => {
    const server = buildServer();
    const email = `rec-all-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Rec" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    await prisma.stravaAccount.create({
      data: { userId, athleteId: `rec-${Date.now()}`, athleteName: "Rec", scope: "read,activity:read_all", accessToken: crypto_.encryptSecret("t"), refreshToken: crypto_.encryptSecret("r"), expiresAt: new Date(Date.now() + 3600_000), historyDoneAt: new Date(), firstRideAt: new Date("2017-05-20T05:00:00Z") },
    });
    const mk = (id: string, start: Date, km: number) =>
      prisma.stravaActivity.create({ data: { id, userId, name: id, sportType: "Ride", startDate: start, startLocal: start, distanceM: km * 1000, movingSec: (km / 25) * 3600, elapsedSec: (km / 18) * 3600, elevationM: km * 8, load: 100, achievementCount: 1, detailFetchedAt: new Date() } });
    await mk("old-600", new Date("2017-05-20T07:00:00Z"), 605);
    await mk("recent-210", new Date(Date.now() - 10 * 86_400_000), 210);
    await prisma.stravaSegmentEffort.create({ data: { id: "kom-2017", userId, activityId: "old-600", segmentId: "s-old", segmentName: "Col de 2017", distanceM: 4000, elapsedSec: 700, startLocal: new Date("2017-05-20T09:00:00Z"), komRank: 1 } });
    const j = (await server.inject({ method: "GET", url: "/api/strava/records", headers: { cookie } })).json();
    expect(j.records.find((r: { key: string }) => r.key === "distance")).toMatchObject({ activityId: "old-600", value: 605 }); // record de 2017
    expect(j.trophies.list[0]).toMatchObject({ kind: "kom", segmentName: "Col de 2017", date: "2017-05-20" }); // KOM ancien
    expect(j.challenges.steps.find((x: { km: number }) => x.km === 600).done).toBe(false); // défis : 13 mois seulement
    expect(j.challenges.steps.find((x: { km: number }) => x.km === 200).done).toBe(true);
    expect(j.history).toMatchObject({ done: true, firstRideAt: "2017-05-20", oldestLoaded: "2017-05-20" });
    // Le tableau de bord ignore les sorties anciennes (30 jours : seulement la récente).
    const dash = (await server.inject({ method: "GET", url: "/api/strava/dashboard", headers: { cookie } })).json();
    expect(dash.kpis.d30.rides).toBe(1);
  });
});
