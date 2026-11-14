import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-group-map.db");
const uploadsDir = path.resolve(repoRoot, "data-test-group-map");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
}

const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
function gpx(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 2000; i++) pts.push(`<trkpt lat="${(48 + 0.01 * Math.sin(i / 50)).toFixed(6)}" lon="${(2 - i / 10 / KM_PER_DEG_LON).toFixed(6)}"><ele>100</ele></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "f6".repeat(32);
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

describe("Carte du groupe le jour J", () => {
  let server: ReturnType<typeof buildServer>;
  const cookies: Record<string, string> = {};
  const rb: Record<string, string> = {};
  const HOUR = 3_600_000;

  async function rider(key: string, prenom: string, startOffsetMs: number, share: boolean) {
    const email = `${key}@example.com`;
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: PASSWORD, prenom } });
    const raw = (await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    cookies[key] = cookie;
    const boundary = "----gm" + key;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BRM 200.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`), Buffer.from(gpx()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = await server.inject({ method: "POST", url: "/api/roadbooks", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    rb[key] = up.json().roadbook.id;
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${rb[key]}`, headers: { cookie }, payload: { startAt: new Date(Date.now() + startOffsetMs).toISOString(), ...(share ? { groupShare: true } : {}) } });
  }
  const live = async (key: string) => (await server.inject({ method: "GET", url: "/api/group/live", headers: { cookie: cookies[key] } })).json().riders as { prenom: string; km: number; mine: boolean; checkinAt: string | null; level: string | null; track: number[][]; lat: number; lon: number }[];

  beforeAll(async () => {
    server = buildServer();
    await rider("anna", "Anna", -3 * HOUR, true); // en cours, partage accepté
    await rider("bruno", "Bruno", -2 * HOUR, false); // en cours, PAS de partage
    await rider("chloe", "Chloé", -40 * HOUR, true); // terminé depuis longtemps (délai 13 h 30 + 6 h)
    await rider("dan", "Dan", 30 * HOUR, true); // départ dans plus de 12 h
    await rider("eve", "Ève", 2 * HOUR, true); // départ dans 2 h : visible, pas encore parti
  });

  it("est réservée aux membres connectés", async () => {
    expect((await server.inject({ method: "GET", url: "/api/group/live" })).statusCode).toBe(401);
  });

  it("le partage est désactivé par défaut et n'apparaît jamais sur le lien public", async () => {
    const mine = (await server.inject({ method: "GET", url: `/api/roadbooks/${rb.bruno}`, headers: { cookie: cookies.bruno } })).json().roadbook;
    expect(mine.groupShare).toBe(false);
    const share = await server.inject({ method: "POST", url: `/api/roadbooks/${rb.anna}/share`, headers: { cookie: cookies.anna }, payload: { enabled: true } });
    const pub = await server.inject({ method: "GET", url: `/api/roadbooks/shared/${share.json().shareToken}` });
    expect(pub.body).not.toContain("groupShare");
  });

  it("ne montre que les randonneurs qui ont accepté, pendant leur brevet", async () => {
    await server.inject({ method: "POST", url: `/api/roadbooks/${rb.anna}/checkins`, headers: { cookie: cookies.anna }, payload: { km: 62, source: "manuel" } });
    await server.inject({ method: "POST", url: `/api/roadbooks/${rb.bruno}/checkins`, headers: { cookie: cookies.bruno }, payload: { km: 40, source: "manuel" } });
    const riders = await live("bruno");
    expect(riders.map((r) => r.prenom)).toEqual(["Anna", "Ève"]); // triés par km ; ni Bruno, ni Chloé, ni Dan
    const anna = riders[0];
    expect(anna.km).toBe(62);
    expect(anna.mine).toBe(false);
    expect(anna.checkinAt).not.toBeNull();
    expect(anna.level).toBe("ok");
    expect(anna.lon).toBeCloseTo(2 - 62 / KM_PER_DEG_LON, 1); // position déduite du tracé au km pointé
    expect(anna.track.length).toBeGreaterThan(1);
    expect(anna.track.length).toBeLessThanOrEqual(260);
    const eve = riders[1];
    expect(eve).toMatchObject({ km: 0, checkinAt: null, level: null }); // pas encore partie
    expect((await live("anna"))[0].mine).toBe(true);
    expect(JSON.stringify(riders)).not.toContain("@example.com");
  });

  it("Bruno apparaît dès qu'il accepte, et disparaît s'il retire son accord", async () => {
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${rb.bruno}`, headers: { cookie: cookies.bruno }, payload: { groupShare: true } });
    expect((await live("anna")).map((r) => r.prenom)).toEqual(["Anna", "Bruno", "Ève"]);
    await server.inject({ method: "PATCH", url: `/api/roadbooks/${rb.bruno}`, headers: { cookie: cookies.bruno }, payload: { groupShare: false } });
    expect((await live("anna")).map((r) => r.prenom)).toEqual(["Anna", "Ève"]);
  });

  it("un compte suspendu disparaît de la carte", async () => {
    await prisma.user.update({ where: { email: "eve@example.com" }, data: { suspendedAt: new Date() } });
    expect((await live("anna")).map((r) => r.prenom)).toEqual(["Anna"]);
  });
});
