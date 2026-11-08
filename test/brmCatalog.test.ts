import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-brm-catalog.db");
const sampleGpxPath = path.resolve(__dirname, "fixtures/sample.gpx");

function buildMultipartBody(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = "----testBoundary" + Date.now();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([pre, content, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function buildMultipartWithLabel(filename: string, contentType: string, content: Buffer, label: string) {
  const boundary = "----testBoundary" + Date.now();
  const filePart = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const labelPart = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${label}`);
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([filePart, content, labelPart, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let generateOpaqueToken: typeof import("../src/lib/tokens.js").generateOpaqueToken;
let hashToken: typeof import("../src/lib/tokens.js").hashToken;
let SESSION_COOKIE: typeof import("../src/lib/session.js").SESSION_COOKIE;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

// Réponse ACP factice (même forme que la vraie API, voir src/lib/acpCatalog.ts).
const FAKE_ACP_RESPONSE = [
  {
    Date: "23/01/2027",
    Distance: 200,
    Pays: "France",
    SiteWeb: "https://club-a.example/",
    Ville: "Rambouillet",
    Departement: "Yvelines",
    Region: "Île-de-France",
    RoadMap: "",
    Denivele: 1200,
    Contact: "A. Dupont",
    NomClub: "Club A",
  },
  {
    Date: "12/06/2027",
    Distance: 600,
    Pays: "France",
    SiteWeb: "https://club-b.example/",
    Ville: "Gacé",
    Departement: "Orne",
    Region: "Normandie",
    RoadMap: "",
    Denivele: 6000,
    Contact: "B. Martin",
    NomClub: "Club B",
  },
  // Doit être filtré par pays côté acpCatalog.ts même si demandé en France.
  { Date: "01/03/2027", Distance: 200, Pays: "Ukraine", SiteWeb: "", Ville: "Kyiv", Departement: "", Region: "", RoadMap: "", Denivele: 0, Contact: "", NomClub: "Club UA" },
  // Doit être filtré par distance (1000 hors scope qualification PBP).
  { Date: "05/04/2027", Distance: 1000, Pays: "France", SiteWeb: "", Ville: "Paris", Departement: "", Region: "", RoadMap: "", Denivele: 0, Contact: "", NomClub: "Club 1000" },
];

const FAKE_CURRENT = {
  name: "Rambouillet",
  main: { temp: 8.9, feels_like: 7.2, humidity: 90 },
  wind: { speed: 5.5, deg: 225, gust: 9.2 },
  weather: [{ description: "couvert" }],
  dt: 1700000000,
};

const FAKE_FORECAST = {
  list: [{ dt: 1700003600, main: { temp: 7.1 }, wind: { speed: 4.1, deg: 180 }, weather: [{ description: "nuageux" }], pop: 0.2 }],
};

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.OPENWEATHER_API_KEY = "test-key";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  ({ generateOpaqueToken, hashToken } = await import("../src/lib/tokens.js"));
  ({ SESSION_COOKIE } = await import("../src/lib/session.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanupDbFiles();
});

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("no set-cookie header in response");
  return raw.split(";")[0];
}

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  const password = "mot-de-passe-de-test-123";
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Test" } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

// Session créée directement en base plutôt que via /api/auth/login : passer par la
// route compterait vers le rate limit par IP (voir src/lib/rateLimit.ts), que cette
// suite dépasserait avec autant de tests enchaînant plusieurs connexions chacun.
async function registerWithSession(server: ReturnType<typeof buildServer>, email: string) {
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "mot-de-passe-de-test-123", prenom: "Test" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = generateOpaqueToken();
  await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) } });
  return `${SESSION_COOKIE}=${token}`;
}

describe("API catalogue BRM (ACP)", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/forecast")) return new Response(JSON.stringify(FAKE_FORECAST), { status: 200 });
        if (url.includes("openweathermap")) return new Response(JSON.stringify(FAKE_CURRENT), { status: 200 });
        return new Response(JSON.stringify(FAKE_ACP_RESPONSE), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ne garde que les BRM France 200-600km, avec un id stable", async () => {
    const cookie = await registerAndLogin(server, `catalog-${Date.now()}@example.com`);
    const res = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const { events } = res.json();
    expect(events).toHaveLength(2);
    expect(events.map((e: { ville: string }) => e.ville).sort()).toEqual(["Gacé", "Rambouillet"]);
    expect(events[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(events.every((e: { myStatus: unknown }) => e.myStatus === null)).toBe(true);
  });

  it("permet à un randonneur de choisir un BRM, visible par un autre utilisateur", async () => {
    const cookieA = await registerAndLogin(server, `catalog-a-${Date.now()}@example.com`);
    const cookieB = await registerAndLogin(server, `catalog-b-${Date.now()}@example.com`);

    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: cookieA } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Rambouillet").id;

    const putRes = await server.inject({
      method: "PUT",
      url: `/api/brm/catalog/${eventId}/participation`,
      headers: { cookie: cookieA },
      payload: { status: "prevu" },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().status).toBe("prevu");

    // Vu par A : son propre statut.
    const listA = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: cookieA } });
    const eventForA = listA.json().events.find((e: { id: string }) => e.id === eventId);
    expect(eventForA.myStatus).toBe("prevu");
    expect(eventForA.participants).toHaveLength(1);

    // Vu par B : le choix de A est visible, mais myStatus reste null pour B.
    const listB = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: cookieB } });
    const eventForB = listB.json().events.find((e: { id: string }) => e.id === eventId);
    expect(eventForB.myStatus).toBeNull();
    expect(eventForB.participants).toEqual([{ displayName: eventForB.participants[0].displayName, status: "prevu" }]);

    // A change d'avis -> "inscrit"
    await server.inject({
      method: "PUT",
      url: `/api/brm/catalog/${eventId}/participation`,
      headers: { cookie: cookieA },
      payload: { status: "inscrit" },
    });
    const listA2 = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: cookieA } });
    expect(listA2.json().events.find((e: { id: string }) => e.id === eventId).myStatus).toBe("inscrit");

    // A retire son choix
    const delRes = await server.inject({
      method: "DELETE",
      url: `/api/brm/catalog/${eventId}/participation`,
      headers: { cookie: cookieA },
    });
    expect(delRes.statusCode).toBe(204);
    const listA3 = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: cookieA } });
    const eventAfterDelete = listA3.json().events.find((e: { id: string }) => e.id === eventId);
    expect(eventAfterDelete.myStatus).toBeNull();
    expect(eventAfterDelete.participants).toEqual([]);
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/brm/catalog" });
    expect(res.statusCode).toBe(401);
  });

  it("rejette un statut invalide", async () => {
    const cookie = await registerAndLogin(server, `catalog-bad-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie } });
    const eventId = listRes.json().events[0].id;

    const res = await server.inject({
      method: "PUT",
      url: `/api/brm/catalog/${eventId}/participation`,
      headers: { cookie },
      payload: { status: "pas-un-statut" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("renvoie la météo d'un BRM du calendrier, basée sur sa ville", async () => {
    const cookie = await registerAndLogin(server, `catalog-meteo-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Rambouillet").id;

    const res = await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/meteo`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().weather.city).toBe("Rambouillet");
  });

  it("renvoie 404 pour une météo demandée sur un id de catalogue inconnu", async () => {
    const cookie = await registerAndLogin(server, `catalog-meteo-404-${Date.now()}@example.com`);
    const res = await server.inject({ method: "GET", url: `/api/brm/catalog/${"0".repeat(16)}/meteo`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it("upload un tracé GPX pour un BRM du calendrier, visible par tout le groupe", async () => {
    const a = await registerAndLogin(server, `catalog-track-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `catalog-track-b-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: a } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Rambouillet").id;

    expect((await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/track`, headers: { cookie: a } })).statusCode).toBe(404);

    const gpx = readFileSync(sampleGpxPath);
    const multipart = buildMultipartBody("file", "mon-brm.gpx", "application/gpx+xml", gpx);
    const uploadRes = await server.inject({
      method: "POST",
      url: `/api/brm/catalog/${eventId}/track`,
      headers: { cookie: a, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const uploaded = uploadRes.json().track;
    expect(uploaded.fileName).toBe("mon-brm.gpx");
    expect(uploaded.points.length).toBeGreaterThan(1);
    expect(uploaded.distanceKm).toBeGreaterThan(0);

    // Visible par un autre utilisateur du groupe, pas seulement par celui qui l'a uploadé.
    const getRes = await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/track`, headers: { cookie: b } });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().track.points.length).toBe(uploaded.points.length);
  });

  it("refuse qu'un autre utilisateur que celui qui a uploadé le tracé le supprime", async () => {
    const a = await registerAndLogin(server, `catalog-track-del-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `catalog-track-del-b-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: a } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Gacé").id;

    const multipart = buildMultipartBody("file", "trace.gpx", "application/gpx+xml", readFileSync(sampleGpxPath));
    await server.inject({
      method: "POST",
      url: `/api/brm/catalog/${eventId}/track`,
      headers: { cookie: a, "content-type": multipart.contentType },
      payload: multipart.body,
    });

    const deleteByB = await server.inject({ method: "DELETE", url: `/api/brm/catalog/${eventId}/track`, headers: { cookie: b } });
    expect(deleteByB.statusCode).toBe(403);

    const deleteByA = await server.inject({ method: "DELETE", url: `/api/brm/catalog/${eventId}/track`, headers: { cookie: a } });
    expect(deleteByA.statusCode).toBe(204);
  });

  it("ajoute des points de ravito/contrôle, visibles par tous, chacun ne retire que les siens", async () => {
    const a = await registerWithSession(server, `catalog-cp-a-${Date.now()}@example.com`);
    const b = await registerWithSession(server, `catalog-cp-b-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: a } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Rambouillet").id;

    const created = await server.inject({
      method: "POST",
      url: `/api/brm/catalog/${eventId}/control-points`,
      headers: { cookie: a },
      payload: { kind: "ravito", label: "Boulangerie du centre", lat: 48.64, lon: 1.83 },
    });
    expect(created.statusCode).toBe(201);
    const point = created.json().point;
    expect(point.mine).toBe(true);

    // Visible par B, mais pas comme "le sien".
    const listByB = await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/control-points`, headers: { cookie: b } });
    expect(listByB.json().points).toHaveLength(1);
    expect(listByB.json().points[0].mine).toBe(false);

    const deleteByB = await server.inject({
      method: "DELETE",
      url: `/api/brm/catalog/${eventId}/control-points/${point.id}`,
      headers: { cookie: b },
    });
    expect(deleteByB.statusCode).toBe(403);

    const deleteByA = await server.inject({
      method: "DELETE",
      url: `/api/brm/catalog/${eventId}/control-points/${point.id}`,
      headers: { cookie: a },
    });
    expect(deleteByA.statusCode).toBe(204);
  });

  it("gère plusieurs variantes de tracé pour le même BRM, sans que l'une remplace l'autre", async () => {
    const a = await registerWithSession(server, `catalog-variant-a-${Date.now()}@example.com`);
    const b = await registerWithSession(server, `catalog-variant-b-${Date.now()}@example.com`);
    const listRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: a } });
    const eventId = listRes.json().events.find((e: { ville: string }) => e.ville === "Gacé").id;

    const gpx = readFileSync(sampleGpxPath);
    const multipartA = buildMultipartWithLabel("variante-a.gpx", "application/gpx+xml", gpx, "Évite Nogent");
    const uploadA = await server.inject({
      method: "POST",
      url: `/api/brm/catalog/${eventId}/track-variants`,
      headers: { cookie: a, "content-type": multipartA.contentType },
      payload: multipartA.body,
    });
    expect(uploadA.statusCode).toBe(201);
    expect(uploadA.json().variant.label).toBe("Évite Nogent");
    expect(uploadA.json().variant.mine).toBe(true);

    const multipartB = buildMultipartBody("file", "variante-b.gpx", "application/gpx+xml", gpx);
    const uploadB = await server.inject({
      method: "POST",
      url: `/api/brm/catalog/${eventId}/track-variants`,
      headers: { cookie: b, "content-type": multipartB.contentType },
      payload: multipartB.body,
    });
    expect(uploadB.statusCode).toBe(201);
    // Pas de libellé fourni : repli sur le nom de fichier.
    expect(uploadB.json().variant.label).toBe("variante-b.gpx");

    const list = await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/track-variants`, headers: { cookie: a } });
    expect(list.json().variants).toHaveLength(2);
    expect(list.json().variants.find((v: { id: string }) => v.id === uploadA.json().variant.id).mine).toBe(true);
    expect(list.json().variants.find((v: { id: string }) => v.id === uploadB.json().variant.id).mine).toBe(false);

    // A ne peut pas supprimer la variante de B.
    const deleteWrongUser = await server.inject({
      method: "DELETE",
      url: `/api/brm/catalog/${eventId}/track-variants/${uploadB.json().variant.id}`,
      headers: { cookie: a },
    });
    expect(deleteWrongUser.statusCode).toBe(403);

    const deleteOwn = await server.inject({
      method: "DELETE",
      url: `/api/brm/catalog/${eventId}/track-variants/${uploadA.json().variant.id}`,
      headers: { cookie: a },
    });
    expect(deleteOwn.statusCode).toBe(204);

    const listAfter = await server.inject({ method: "GET", url: `/api/brm/catalog/${eventId}/track-variants`, headers: { cookie: a } });
    expect(listAfter.json().variants).toHaveLength(1);
  });
});
