import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-pbp-routes.db");
const uploadsDir = path.resolve(repoRoot, "data-test-pbp");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let geo: typeof import("../src/lib/geo.js");
let gpx: typeof import("../src/lib/gpx.js");
let controlsLib: typeof import("../src/lib/pbpControls.js");
let routeWeather: typeof import("../src/lib/routeWeather.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true });
}

// Faux PBP dense : passe par les vraies villes de contrôle dans l'ordre (donc
// Tinténiac/Fougères/Villaines/Mortagne deux fois), un point tous les ~20 m, avec
// des bosses sinusoïdales — de quoi éprouver la simplification et la projection des
// contrôles comme un vrai GPX de 1200 km. Le retour est légèrement décalé vers le
// sud (route différente de l'aller, comme annoncé pour 2027).
function syntheticPbpGpx(withWaypoints = false): string {
  const ctrl = controlsLib.PBP_2027_CONTROLS;
  const pts: string[] = [];
  let k = 0;
  for (let i = 1; i < ctrl.length; i++) {
    const a = ctrl[i - 1];
    const b = ctrl[i];
    const segM = geo.haversineMeters(a, b);
    const steps = Math.max(1, Math.round(segM / 20));
    const latShift = i > 7 ? -0.01 : 0;
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      // Décalage seulement en milieu de segment : les extrémités restent sur les villes.
      const bulge = Math.sin(t * Math.PI) * latShift;
      const lat = a.lat + t * (b.lat - a.lat) + bulge;
      const lon = a.lon + t * (b.lon - a.lon);
      const ele = 120 + 60 * Math.sin(k / 400) + 15 * Math.sin(k / 37);
      pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`);
      k++;
    }
  }
  const wpts = withWaypoints ? `<wpt lat="48.3904" lon="-4.4861"><name>Contrôle Brest</name></wpt>` : "";
  return `<?xml version="1.0"?><gpx version="1.1" creator="test">${wpts}<trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

function multipart(fields: Record<string, string>, filename: string, content: string) {
  const boundary = "----pbpBoundary" + Date.now();
  const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  const body = Buffer.concat([
    Buffer.from(parts.join("")),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "44".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.OPENWEATHER_API_KEY = "test-key";
  process.env.UPLOADS_DIR = uploadsDir;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  geo = await import("../src/lib/geo.js");
  gpx = await import("../src/lib/gpx.js");
  controlsLib = await import("../src/lib/pbpControls.js");
  routeWeather = await import("../src/lib/routeWeather.js");
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("Géométrie du parcours", () => {
  it("Douglas-Peucker 3D allège une ligne droite mais garde une bosse qu'un DP planaire effacerait", () => {
    const pts = Array.from({ length: 1001 }, (_, i) => ({
      lat: 48 + i * 0.0001,
      lon: 2,
      // Bosse de 40 m au milieu d'une route parfaitement rectiligne.
      ele: i > 450 && i < 550 ? 100 + 40 * Math.sin(((i - 450) / 100) * Math.PI) : 100,
      distKm: i * 0.0111,
    }));
    const simplified = geo.douglasPeucker3D(pts, 5);
    expect(simplified.length).toBeLessThan(40);
    expect(simplified[0]).toBe(pts[0]);
    expect(simplified[simplified.length - 1]).toBe(pts[1000]);
    const maxEle = Math.max(...simplified.map((p) => p.ele ?? 0));
    expect(maxEle).toBeGreaterThan(135); // le sommet de la bosse est conservé
  });

  it("simplifie un GPX de 1200 km (~60 000 points) sous 4000 points, sans fausser distance ni D+", () => {
    const xml = syntheticPbpGpx();
    const t0 = Date.now();
    const route = gpx.parseGpxRoute(xml)!;
    const elapsed = Date.now() - t0;

    expect(route.rawPointCount).toBeGreaterThan(40_000);
    expect(route.points.length).toBeLessThanOrEqual(4000);
    // distKm vient du tracé complet : le dernier point simplifié porte la vraie distance.
    expect(Math.abs(route.points[route.points.length - 1].distKm - route.stats.distanceKm)).toBeLessThan(0.2);
    expect(route.stats.elevationGainM).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(5000);
  });

  it("retrouve chaque contrôle au bon passage (aller ≠ retour pour les villes visitées deux fois)", () => {
    const route = gpx.parseGpxRoute(syntheticPbpGpx())!;
    const projected = controlsLib.projectControls(route.points);
    const kms = projected.map((c) => c.km);
    expect(kms.every((k) => k !== null)).toBe(true);
    for (let i = 1; i < kms.length; i++) expect(kms[i]!).toBeGreaterThan(kms[i - 1]!);

    const tinteniac = projected.filter((c) => c.name === "Tinténiac");
    const brest = projected.find((c) => c.name === "Brest")!;
    expect(tinteniac[0].km!).toBeLessThan(brest.km!);
    expect(tinteniac[1].km!).toBeGreaterThan(brest.km!);
  });

  it("construit un tracé indicatif recalé sur les distances officielles connues", () => {
    const { points, controlKms } = controlsLib.buildIndicativeRoute();
    expect(controlKms[0]).toBe(0);
    expect(controlKms[1]).toBe(119); // Mortagne aller
    expect(controlKms[7]).toBe(590); // Brest
    expect(controlKms[16]).toBe(1220);
    expect(points[points.length - 1].distKm).toBeCloseTo(1220, 0);
  });

  it("classe le vent de face / dos par rapport au cap local de la route", () => {
    // Route vers l'ouest (270°), vent venant de l'ouest : plein face.
    const face = routeWeather.windAlongRoute(270, 30, 270);
    expect(face.relation).toBe("face");
    expect(face.alongKmh).toBe(-30);
    const dos = routeWeather.windAlongRoute(90, 30, 270);
    expect(dos.relation).toBe("dos");
    expect(dos.alongKmh).toBe(30);
    expect(routeWeather.windAlongRoute(0, 30, 270).relation).toBe("travers");
  });
});

function fakeForecast(fromMs: number) {
  return {
    city: { name: "Villetest" },
    list: Array.from({ length: 40 }, (_, i) => ({
      dt: Math.floor((fromMs + i * 3 * 3600_000) / 1000),
      // Vent d'ouest soutenu : de face à l'aller (vers Brest), de dos au retour.
      main: { temp: 14, feels_like: 12 },
      wind: { speed: 9, deg: 270, gust: 14 },
      weather: [{ description: "nuageux", icon: "04d" }],
      pop: 0.7,
      rain: { "3h": 2.5 },
    })),
  };
}

describe("API Parcours PBP", () => {
  let server: ReturnType<typeof buildServer>;
  let adminCookie: string;
  let userCookie: string;
  let otherCookie: string;

  async function login(email: string, admin: boolean) {
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Test" } });
    if (admin) await prisma.user.update({ where: { email }, data: { isAdmin: true } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
  }

  async function upload(cookie: string, fields: Record<string, string>, content = syntheticPbpGpx(true)) {
    const { body, contentType } = multipart(fields, "pbp.gpx", content);
    return server.inject({ method: "POST", url: "/api/pbp/routes", headers: { cookie, "content-type": contentType }, payload: body });
  }

  beforeAll(async () => {
    server = buildServer();
    adminCookie = await login(`pbp-admin-${Date.now()}@example.com`, true);
    userCookie = await login(`pbp-user-${Date.now()}@example.com`, false);
    otherCookie = await login(`pbp-other-${Date.now()}@example.com`, false);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fakeForecast(Date.now())), { status: 200 })));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.pbpRoute.deleteMany();
  });

  it("propose le tracé indicatif tant qu'aucun GPX n'est importé", async () => {
    const res = await server.inject({ method: "GET", url: "/api/pbp/routes", headers: { cookie: userCookie } });
    expect(res.json().defaultId).toBe("indicatif");
    expect(res.json().routes.map((r: { id: string }) => r.id)).toEqual(["indicatif"]);

    const detail = await server.inject({ method: "GET", url: "/api/pbp/routes/indicatif", headers: { cookie: userCookie } });
    expect(detail.json().controls).toHaveLength(17);
    expect(detail.json().points[0]).toHaveLength(4); // format compact [lat, lon, ele, km]
  });

  it("un non-admin ne peut importer qu'un tracé communautaire, même s'il demande 'officiel'", async () => {
    const res = await upload(userCookie, { label: "Ma trace", kind: "officiel" });
    expect(res.statusCode).toBe(201);
    expect(res.json().route.kind).toBe("communautaire");
    expect(res.json().simplifiedPointCount).toBeLessThanOrEqual(4000);
  });

  it("bascule automatiquement sur le tracé officiel dès qu'il est importé", async () => {
    await upload(userCookie, { label: "Communautaire" });
    const provisoire = await upload(adminCookie, { label: "Provisoire", kind: "provisoire" });
    let list = await server.inject({ method: "GET", url: "/api/pbp/routes", headers: { cookie: userCookie } });
    expect(list.json().defaultId).toBe(provisoire.json().route.id);

    const officiel = await upload(adminCookie, { label: "Officiel 2027", kind: "officiel" });
    list = await server.inject({ method: "GET", url: "/api/pbp/routes", headers: { cookie: userCookie } });
    expect(list.json().defaultId).toBe(officiel.json().route.id);
    // Les anciens tracés restent disponibles pour comparaison.
    expect(list.json().routes).toHaveLength(4);
  });

  it("projette les contrôles et les waypoints du GPX sur le tracé importé", async () => {
    const created = await upload(adminCookie, { label: "Provisoire", kind: "provisoire" });
    const detail = await server.inject({ method: "GET", url: `/api/pbp/routes/${created.json().route.id}`, headers: { cookie: userCookie } });
    const body = detail.json();
    expect(body.controls.every((c: { km: number | null }) => c.km !== null)).toBe(true);
    expect(body.waypoints[0].name).toBe("Contrôle Brest");
    expect(body.waypoints[0].km).toBeCloseTo(body.controls.find((c: { name: string }) => c.name === "Brest").km, -1);
  });

  it("réserve la modification à l'admin et la suppression à l'auteur ou l'admin", async () => {
    const created = await upload(userCookie, { label: "À moi" });
    const id = created.json().route.id;

    const patchByUser = await server.inject({ method: "PATCH", url: `/api/pbp/routes/${id}`, headers: { cookie: userCookie }, payload: { kind: "officiel" } });
    expect(patchByUser.statusCode).toBe(403);
    const patchByAdmin = await server.inject({ method: "PATCH", url: `/api/pbp/routes/${id}`, headers: { cookie: adminCookie }, payload: { kind: "provisoire" } });
    expect(patchByAdmin.json().route.kind).toBe("provisoire");

    const delByOther = await server.inject({ method: "DELETE", url: `/api/pbp/routes/${id}`, headers: { cookie: otherCookie } });
    expect(delByOther.statusCode).toBe(403);
    const delByOwner = await server.inject({ method: "DELETE", url: `/api/pbp/routes/${id}`, headers: { cookie: userCookie } });
    expect(delByOwner.statusCode).toBe(204);
  });

  it("rejette un fichier qui n'est pas un GPX exploitable", async () => {
    const res = await upload(userCookie, { label: "Cassé" }, "<gpx><trk></trk></gpx>");
    expect(res.statusCode).toBe(422);
  });

  it("calcule la météo le long du parcours : contrôles, heure de passage, vent de face/dos, alertes", async () => {
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const res = await server.inject({
      method: "GET",
      url: `/api/pbp/routes/indicatif/weather?start=${encodeURIComponent(start)}&speed=15&step=100`,
      headers: { cookie: userCookie },
    });
    expect(res.statusCode).toBe(200);
    const { samples } = res.json();

    const brest = samples.find((s: { label: string }) => s.label === "Brest");
    expect(brest.isControl).toBe(true);
    // 590 km à 15 km/h = 39h20 après le départ.
    expect(new Date(brest.eta).getTime() - new Date(start).getTime()).toBeCloseTo(590 / 15 * 3600_000, -4);

    const firstLeg = samples.find((s: { km: number; forecast: unknown }) => s.km > 150 && s.km < 450 && s.forecast);
    expect(firstLeg.forecast.windRelation).toBe("face"); // vent d'ouest, on roule vers l'ouest
    expect(firstLeg.alerts).toContain("vent_de_face");
    expect(firstLeg.alerts).toContain("pluie");

    const returnLeg = samples.find((s: { km: number; forecast: unknown }) => s.km > 700 && s.km < 1000 && s.forecast);
    expect(returnLeg.forecast.windRelation).toBe("dos");
  });

  it("signale les passages au-delà de l'horizon de prévision au lieu d'inventer une météo", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/api/pbp/routes/indicatif/weather?start=${encodeURIComponent("2027-08-22T17:45:00+02:00")}&speed=14`,
      headers: { cookie: userCookie },
    });
    expect(res.json().samples.every((s: { outOfRange: boolean; forecast: unknown }) => s.outOfRange && s.forecast === null)).toBe(true);
  });
});
