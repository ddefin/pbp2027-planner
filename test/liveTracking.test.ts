import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Page de suivi des proches : statut et petit mot au pointage, lien Strava Beacon, vue en
// direct enrichie (rafales, +2 h / +3 h, vent par rapport au tronçon), calculs partagés.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-live-tracking.db");
const uploadsDir = path.resolve(repoRoot, "data-test-live-tracking");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let calc: typeof import("../src/shared/roadbookCalc.js");
let sun: typeof import("../src/shared/sunTimes.js");
let situation: typeof import("../src/lib/roadbookSituation.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
}

// Ligne droite plein ouest de 200 km (le vent d'est est donc de dos).
const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
const lonAt = (km: number) => 2 - km / KM_PER_DEG_LON;
function straightGpx(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 2000; i++) pts.push(`<trkpt lat="48" lon="${lonAt(i / 10).toFixed(6)}"><ele>${100 + (i % 200 < 100 ? i % 100 : 100 - (i % 100))}</ele></trkpt>`);
  const wpt = (km: number, name: string) => `<wpt lat="48.0005" lon="${lonAt(km)}"><name>${name}</name></wpt>`;
  return `<?xml version="1.0"?><gpx version="1.1">${wpt(100, "CP1 Bourg")}<trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

const weatherCalls: string[] = [];
beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "77".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.OPENWEATHER_API_KEY = "test-key";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  calc = await import("../src/shared/roadbookCalc.js");
  sun = await import("../src/shared/sunTimes.js");
  situation = await import("../src/lib/roadbookSituation.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      weatherCalls.push(u);
      const wind = { speed: 5, gust: 12, deg: 90 }; // vent d'est : 18 km/h, rafales 43 km/h
      if (u.includes("/geo/1.0/reverse")) return new Response(JSON.stringify([{ name: "Bourg", local_names: { fr: "Bourg" } }]), { status: 200 });
      if (u.includes("/data/2.5/weather"))
        return new Response(JSON.stringify({ dt: Math.floor(Date.now() / 1000), name: "Bourg", main: { temp: 14, feels_like: 12, humidity: 70 }, weather: [{ description: "nuageux", icon: "04d" }], wind }), { status: 200 });
      if (u.includes("/data/2.5/forecast")) {
        const now = Math.floor(Date.now() / 1000);
        const list = Array.from({ length: 16 }, (_, i) => ({ dt: now - 3600 + i * 3 * 3600, main: { temp: 13 + i, feels_like: 12 + i, humidity: 60 }, weather: [{ description: "averses", icon: "10d" }], wind, pop: 0.4, rain: { "3h": 1 } }));
        return new Response(JSON.stringify({ city: { name: "Bourg" }, list }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Calculs partagés du suivi", () => {
  it("donne l'heure réelle de passage aux contrôles", () => {
    const controls = [{ km: 0 }, { km: 100 }, { km: 200 }];
    const checkins = [
      { km: 150, at: "2027-05-01T14:00:00Z" },
      { km: 100.4, at: "2027-05-01T11:00:00Z" },
      { km: 0, at: "2027-05-01T06:00:00Z" },
    ];
    expect(calc.controlPassages(controls, checkins)).toEqual(["2027-05-01T06:00:00Z", "2027-05-01T11:00:00Z", null]);
  });

  it("estime la position au rythme constaté, plafonnée et seulement en route", () => {
    const base = { lastKm: 50, lastAt: "2027-05-01T10:00:00Z", avgKmh: 20, now: new Date("2027-05-01T11:00:00Z"), totalKm: 200, nextControlKm: 100, status: "route" as const };
    expect(calc.estimatedKm(base)?.km).toBeCloseTo(70);
    expect(calc.estimatedKm({ ...base, now: new Date("2027-05-01T14:00:00Z") })).toMatchObject({ km: 100, capped: true }); // s'arrête au contrôle
    expect(calc.estimatedKm({ ...base, now: new Date("2027-05-01T17:00:00Z") })).toBeNull(); // plus de 6 h : trop incertain
    for (const status of ["pause", "arrive", "abandon"] as const) expect(calc.estimatedKm({ ...base, status })).toBeNull();
    expect(calc.estimatedKm({ ...base, avgKmh: null })).toBeNull();
  });

  it("calcule lever et coucher du soleil (valeurs connues à la minute près)", () => {
    const hm = (d: Date | null) => d!.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
    const paris = sun.sunTimes(48.8566, 2.3522, new Date("2027-06-21T12:00:00Z"));
    expect(hm(paris.sunrise)).toMatch(/^05:4[5-8]$/);
    expect(hm(paris.sunset)).toMatch(/^21:5[6-9]$/);
    const brest = sun.sunTimes(48.39, -4.49, new Date("2027-08-22T12:00:00Z"));
    expect(hm(brest.sunrise)).toMatch(/^07:(1[8-9]|2[0-2])$/);
    expect(hm(brest.sunset)).toMatch(/^21:(1[8-9]|2[0-3])$/);
    const night = sun.daylight(48.39, -4.49, new Date("2027-08-22T21:00:00Z")); // 23 h à Brest
    expect(night.isNight).toBe(true);
    expect(night.nextChange!.getTime()).toBeGreaterThan(new Date("2027-08-23T04:00:00Z").getTime());
  });

  it("donne le cap moyen du tronçon en cours", () => {
    const pts = Array.from({ length: 201 }, (_, i) => ({ lat: 48, lon: lonAt(i), ele: 100, distKm: i }));
    expect(situation.sectionBearing(pts, 10, 100)).toBeCloseTo(270, 0);
  });
});

describe("Pointage avec statut, lien Beacon et vue en direct", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let id: string;
  let token: string;

  beforeAll(async () => {
    server = buildServer();
    const email = `live-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const boundary = "----live" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BRM 200.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
      Buffer.from(straightGpx()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    id = up.json().roadbook.id;
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${id}`, headers: { cookie }, payload: { startAt: new Date(Date.now() - 3 * 3600_000).toISOString() } });
    token = (await server.inject({ method: "POST", url: `/api/roadbooks/${id}/share`, headers: { cookie }, payload: { enabled: true } })).json().shareToken;
  });

  it("accepte un lien Strava Beacon, refuse les autres adresses", async () => {
    const patch = (beaconUrl: string | null) => server.inject({ method: "PATCH", url: `/api/roadbooks/${id}`, headers: { cookie }, payload: { beaconUrl } });
    for (const bad of ["http://www.strava.com/beacon/abc", "https://evil.example/beacon/abc", "https://www.strava.com/athletes/1", "https://strava.com.evil.io/beacon/x"]) {
      expect((await patch(bad)).statusCode, bad).toBe(400);
    }
    expect((await patch("https://www.strava.com/beacon/AbC123xyz")).json().roadbook.beaconUrl).toBe("https://www.strava.com/beacon/AbC123xyz");
    const pub = (await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}` })).json();
    expect(pub.roadbook.beaconUrl).toBe("https://www.strava.com/beacon/AbC123xyz");
  });

  it("enregistre statut et petit mot, les expose aux proches, refuse un mot trop long", async () => {
    const post = (payload: object) => server.inject({ method: "POST", url: `/api/roadbooks/${id}/checkins`, headers: { cookie }, payload });
    expect((await post({ km: 20, source: "manuel", status: "dodo" })).statusCode).toBe(400);
    expect((await post({ km: 20, source: "manuel", message: "x".repeat(141) })).statusCode).toBe(400);
    const ok = await post({ km: 60, source: "manuel", status: "pause", message: "  Pause   repas <b>ok</b>\n" , announce: false });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().checkin).toMatchObject({ status: "pause", message: "Pause repas <b>ok</b>" });
    const plain = await post({ km: 70, source: "manuel", announce: false });
    expect(plain.json().checkin).toMatchObject({ status: "route", message: null }); // valeur par défaut
    const pub = (await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}` })).json();
    expect(pub.checkins[1]).toMatchObject({ km: 60, status: "pause", message: "Pause repas <b>ok</b>" });
  });

  it("vue en direct : rythme, rafales, vent de dos sur le tronçon, prévisions +2 h et +3 h", async () => {
    const live = (await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}/live` })).json();
    expect(live.status).toBe("route");
    expect(live.avgAllKmh).toBeGreaterThan(20);
    expect(live.sectionBearing).toBeCloseTo(270, 0);
    expect(live.outlook.map((w: { hoursAhead: number }) => w.hoursAhead)).toEqual([0, 2, 3]);
    const [now, in2] = live.outlook;
    expect(now.windGustsKmh).toBe(43);
    expect(now.relation).toBe("dos");
    expect(in2.km).toBeGreaterThan(70); // il aura avancé à son rythme
    expect(in2.rainProbability).toBeCloseTo(0.4);
    expect(in2.rainMm).toBe(1);
  });

  it("abandon : plus de prévision devant, statut et mot transmis", async () => {
    await server.inject({ method: "POST", url: `/api/roadbooks/${id}/checkins`, headers: { cookie }, payload: { km: 80, source: "manuel", status: "abandon", message: "Genou douloureux, je rentre", announce: false } });
    const live = (await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}/live` })).json();
    expect(live.status).toBe("abandon");
    expect(live.message).toBe("Genou douloureux, je rentre");
    expect(live.finished).toBe(false);
    expect(live.outlook.every((w: { hoursAhead: number }) => w.hoursAhead === 0)).toBe(true);
    const msg = await situation.latestSituationMessage(id);
    expect(msg!.html).toContain("Abandon");
    expect(msg!.html).toContain("Genou douloureux");
    expect(msg!.html).not.toContain("ARRIVÉE ESTIMÉE");
    expect(msg!.html).toContain("Strava Beacon");
  });

  it("arrivée déclarée : statut arrivé même avant le dernier km", async () => {
    await server.inject({ method: "POST", url: `/api/roadbooks/${id}/checkins`, headers: { cookie }, payload: { km: 199.5, source: "manuel", status: "arrive", announce: false } });
    const live = (await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}/live` })).json();
    expect(live.status).toBe("arrive");
    expect(live.finished).toBe(true);
  });
});
