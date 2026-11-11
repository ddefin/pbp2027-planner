import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-roadbooks.db");
const uploadsDir = path.resolve(repoRoot, "data-test-roadbooks");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true });
}

// Aller-retour de ~204 km vers l'ouest et retour (route légèrement décalée au retour),
// avec un contrôle sur la même commune à l'aller ET au retour, un demi-tour, et un
// waypoint qui n'est pas un contrôle.
function outAndBackGpx(): string {
  const pts: string[] = [];
  const kmPerDegLon = 111.32 * Math.cos((48 * Math.PI) / 180);
  const halfDeg = 102 / kmPerDegLon;
  const n = 2000;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const out = t <= 0.5;
    const lon = 2 - (out ? t * 2 : (1 - t) * 2) * halfDeg;
    const lat = out ? 48 : 48.003;
    const ele = 100 + 80 * Math.sin(t * Math.PI * 6);
    pts.push(`<trkpt lat="${lat}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`);
  }
  const at = (km: number) => (2 - km / kmPerDegLon).toFixed(6);
  const wpts = [
    `<wpt lat="48.0015" lon="${at(50)}"><name>CP1 Bourg</name></wpt>`,
    `<wpt lat="48.0010" lon="${at(70)}"><name>Boulangerie</name></wpt>`,
    `<wpt lat="48.0015" lon="${at(102)}"><name>CP2 Demi-tour</name></wpt>`,
    `<wpt lat="48.0015" lon="${at(50)}"><name>CP3 Bourg (retour)</name></wpt>`,
  ].join("");
  return `<?xml version="1.0"?><gpx version="1.1">${wpts}<trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

function multipart(filename: string, content: string) {
  const boundary = "----rbBoundary" + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/gpx+xml\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "66".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("API Roadbook", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let otherCookie: string;
  let roadbookId: string;

  async function login(email: string) {
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Didier" } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
  }

  beforeAll(async () => {
    server = buildServer();
    cookie = await login(`rb-${Date.now()}@example.com`);
    otherCookie = await login(`rb-other-${Date.now()}@example.com`);
  });

  it("importe un GPX : distance, D+, type de BRM deviné, contrôles et POI séparés", async () => {
    const { body, contentType } = multipart("BRM 200 Rambouillet.gpx", outAndBackGpx());
    const res = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(201);
    const rb = res.json().roadbook;
    roadbookId = rb.id;

    expect(rb.title).toBe("BRM 200 Rambouillet");
    expect(rb.distanceKm).toBeGreaterThan(200);
    expect(rb.classKm).toBe(200);
    expect(rb.limitMinutes).toBe(810);
    expect(rb.elevationGainM).toBeGreaterThan(400);

    const names = rb.controls.map((c: { name: string }) => c.name);
    expect(names).toEqual(["Départ", "CP1 Bourg", "CP2 Demi-tour", "CP3 Bourg (retour)", "Arrivée"]);
    // Même commune à l'aller et au retour : deux km bien distincts.
    const cp1 = rb.controls.find((c: { name: string }) => c.name === "CP1 Bourg").km;
    const cp3 = rb.controls.find((c: { name: string }) => c.name === "CP3 Bourg (retour)").km;
    expect(cp1).toBeCloseTo(50, -1);
    expect(cp3).toBeGreaterThan(140);
    expect(rb.pois.map((p: { name: string }) => p.name)).toEqual(["Boulangerie"]);
  });

  it("renvoie le tracé complet au propriétaire, rien aux autres", async () => {
    const mine = await server.inject({ method: "GET", url: `/api/roadbooks/${roadbookId}`, headers: { cookie } });
    expect(mine.json().roadbook.points.length).toBeGreaterThan(10);
    const other = await server.inject({ method: "GET", url: `/api/roadbooks/${roadbookId}`, headers: { cookie: otherCookie } });
    expect(other.statusCode).toBe(404);
    const otherPatch = await server.inject({ method: "PATCH", url: `/api/roadbooks/${roadbookId}`, headers: { cookie: otherCookie }, payload: { title: "volé" } });
    expect(otherPatch.statusCode).toBe(404);
  });

  it("enregistre les réglages d'allure et les contrôles modifiés (triés par km)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/api/roadbooks/${roadbookId}`,
      headers: { cookie },
      payload: {
        startAt: "2027-03-06T07:00:00+01:00",
        movingSpeedKmh: 24.5,
        climbPenaltyMinPer100m: 4,
        controls: [
          { name: "Arrivée", km: 204, stopMinutes: 0 },
          { name: "Départ", km: 0, stopMinutes: 0 },
          { name: "Ravito perso", km: 120, stopMinutes: 25 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().roadbook.controls.map((c: { name: string }) => c.name)).toEqual(["Départ", "Ravito perso", "Arrivée"]);
    expect(res.json().roadbook.movingSpeedKmh).toBe(24.5);
  });

  it("refuse un contrôle placé au-delà de la fin du tracé", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/api/roadbooks/${roadbookId}`,
      headers: { cookie },
      payload: { controls: [{ name: "Départ", km: 0, stopMinutes: 0 }, { name: "Loin", km: 900, stopMinutes: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("partage en lecture seule sans session, sans exposer email ni identifiants, et révoque", async () => {
    const share = await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/share`, headers: { cookie }, payload: { enabled: true } });
    const token = share.json().shareToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie }, payload: { km: 63.5, lat: 48, lon: 1.2, source: "gps" } });

    const pub = await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}` });
    expect(pub.statusCode).toBe(200);
    const raw = pub.body;
    expect(raw).not.toContain("@example.com");
    expect(raw).not.toContain(roadbookId);
    expect(raw).not.toContain(token);
    expect(pub.json().roadbook.author).toBe("Didier");
    expect(pub.json().checkins[0].km).toBe(63.5);

    // Régénérer révoque l'ancien lien.
    await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/share`, headers: { cookie }, payload: { enabled: true } });
    expect((await server.inject({ method: "GET", url: `/api/roadbooks/shared/${token}` })).statusCode).toBe(404);
    await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/share`, headers: { cookie }, payload: { enabled: false } });
    expect((await prisma.roadbook.findUniqueOrThrow({ where: { id: roadbookId } })).shareToken).toBeNull();
  });

  it("enregistre les pointages, refuse un km hors tracé, et remet le suivi à zéro", async () => {
    const bad = await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie }, payload: { km: 999, source: "manuel" } });
    expect(bad.statusCode).toBe(400);
    const ok = await server.inject({ method: "POST", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie }, payload: { km: 80, source: "manuel" } });
    expect(ok.statusCode).toBe(201);
    const detail = await server.inject({ method: "GET", url: `/api/roadbooks/${roadbookId}`, headers: { cookie } });
    expect(detail.json().checkins[0].km).toBe(80);

    await server.inject({ method: "DELETE", url: `/api/roadbooks/${roadbookId}/checkins`, headers: { cookie } });
    const after = await server.inject({ method: "GET", url: `/api/roadbooks/${roadbookId}`, headers: { cookie } });
    expect(after.json().checkins).toEqual([]);
  });

  it("supprime le roadbook et ses pointages", async () => {
    const res = await server.inject({ method: "DELETE", url: `/api/roadbooks/${roadbookId}`, headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect(await prisma.roadbookCheckin.count({ where: { roadbookId } })).toBe(0);
  });
});
