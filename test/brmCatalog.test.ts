import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-brm-catalog.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

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
});
