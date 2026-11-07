// Dans un fichier séparé exprès : src/config.ts lit OPENWEATHER_API_KEY une seule
// fois à l'import, donc ce scénario "pas de clé" a besoin d'un graphe de modules
// vierge (vitest isole chaque fichier de test dans son propre contexte).
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-meteo-no-key.db");

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

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "88".repeat(32);
  process.env.COOKIE_SECURE = "false";
  delete process.env.OPENWEATHER_API_KEY;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanupDbFiles();
});

describe("API Météo sans clé configurée", () => {
  it("renvoie 503 plutôt que de planter", async () => {
    const server = buildServer();
    const password = "mot-de-passe-de-test-123";
    const email = `mt-noconf-${Date.now()}@example.com`;
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password } });
    const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const cookie = extractCookie(loginRes.headers["set-cookie"]);

    const created = await server.inject({
      method: "POST",
      url: "/api/brm",
      headers: { cookie },
      payload: { distance: 200, date: "2027-02-14T06:00:00.000Z", lieu: "Rambouillet" },
    });
    const brmId = created.json().event.id;

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/meteo`, headers: { cookie } });
    expect(res.statusCode).toBe(503);
  });
});
