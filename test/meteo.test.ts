import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-meteo.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("no set-cookie header in response");
  return raw.split(";")[0];
}

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  const password = "mot-de-passe-de-test-123";
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

async function createBrmEvent(server: ReturnType<typeof buildServer>, cookie: string, lieu = "Rambouillet") {
  const res = await server.inject({
    method: "POST",
    url: "/api/brm",
    headers: { cookie },
    payload: { distance: 200, date: "2027-02-14T06:00:00.000Z", lieu },
  });
  return res.json().event.id as string;
}

const FAKE_CURRENT = {
  name: "Rambouillet",
  main: { temp: 8.9, feels_like: 7.2, humidity: 90 },
  wind: { speed: 5.5, deg: 225, gust: 9.2 },
  weather: [{ description: "couvert" }],
  dt: 1700000000,
};

const FAKE_FORECAST = {
  list: [
    { dt: 1700003600, main: { temp: 7.1 }, wind: { speed: 4.1, deg: 180 }, weather: [{ description: "nuageux" }], pop: 0.2 },
    { dt: 1700014400, main: { temp: 5.4 }, wind: { speed: 6.9, deg: 270, gust: 12.1 }, weather: [{ description: "pluie" }], pop: 0.8 },
  ],
};

describe("API Météo", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    cleanupDbFiles();
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.MFA_ENCRYPTION_KEY = "77".repeat(32);
    process.env.COOKIE_SECURE = "false";
    process.env.OPENWEATHER_API_KEY = "test-key";
    execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

    ({ buildServer } = await import("../src/server.js"));
    ({ prisma } = await import("../src/db.js"));
    server = buildServer();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    cleanupDbFiles();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/forecast")) return new Response(JSON.stringify(FAKE_FORECAST), { status: 200 });
        return new Response(JSON.stringify(FAKE_CURRENT), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/brm/whatever/meteo" });
    expect(res.statusCode).toBe(401);
  });

  it("renvoie 404 pour un BRM qui n'appartient pas à l'utilisateur", async () => {
    const a = await registerAndLogin(server, `mt-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `mt-b-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, a);

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie: b } });
    expect(res.statusCode).toBe(404);
  });

  it("renvoie la météo actuelle et les prévisions, converties en unités utiles", async () => {
    const cookie = await registerAndLogin(server, `mt-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { weather } = res.json();

    expect(weather.city).toBe("Rambouillet");
    expect(weather.current.tempC).toBe(9); // 8.9 arrondi
    expect(weather.current.windSpeedKmh).toBe(20); // 5.5 m/s -> km/h arrondi
    expect(weather.current.windGustsKmh).toBe(33);
    expect(weather.current.windDirection).toBe("SO"); // 225°
    expect(weather.forecast).toHaveLength(2);
    expect(weather.forecast[1].precipitationProbability).toBe(0.8);
    expect(weather.forecast[1].windDirection).toBe("O"); // 270°
  });

  it("met en cache les appels au même lieu (un seul fetch réseau pour deux requêtes)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/forecast")) return new Response(JSON.stringify(FAKE_FORECAST), { status: 200 });
      return new Response(JSON.stringify(FAKE_CURRENT), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const cookie = await registerAndLogin(server, `mt-cache-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie, "Chartres");

    await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie } });
    await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie } });

    expect(fetchSpy).toHaveBeenCalledTimes(2); // current + forecast, une seule fois chacun
  });

  it("renvoie 502 si OpenWeatherMap échoue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    const cookie = await registerAndLogin(server, `mt-fail-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie, "Un lieu jamais demandé avant");

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie } });
    expect(res.statusCode).toBe(502);
  });
});
