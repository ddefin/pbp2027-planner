import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-brm.db");

// Les modules applicatifs lisent leurs variables d'env à l'import (config.ts).
// On les fixe avant tout import statique de ces modules, d'où les imports dynamiques ci-dessous.
let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "11".repeat(32);
  process.env.COOKIE_SECURE = "false";
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

async function registerAndLogin(app: Awaited<ReturnType<typeof buildServer>>, email: string) {
  const password = "mot-de-passe-de-test-123";
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password } });
  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

describe("API BRM", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/brm" });
    expect(res.statusCode).toBe(401);
  });

  it("couvre le cycle de vie complet d'un BRM", async () => {
    const cookie = await registerAndLogin(server, `brm-${Date.now()}@example.com`);

    const empty = await server.inject({ method: "GET", url: "/api/brm", headers: { cookie } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().events).toEqual([]);

    const created = await server.inject({
      method: "POST",
      url: "/api/brm",
      headers: { cookie },
      payload: { distance: 200, date: "2027-02-14T06:00:00.000Z", lieu: "Rambouillet" },
    });
    expect(created.statusCode).toBe(201);
    const event = created.json().event;
    expect(event.status).toBe("a-venir");
    expect(event.limiteMinutes).toBe(810); // barème officiel 200km = 13h30

    const afterCreate = await server.inject({ method: "GET", url: "/api/brm", headers: { cookie } });
    expect(afterCreate.json().events).toHaveLength(1);

    const updated = await server.inject({
      method: "PATCH",
      url: `/api/brm/${event.id}`,
      headers: { cookie },
      payload: { status: "fait", tempsRealiseMinutes: 492 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().event.status).toBe("fait");
    expect(updated.json().event.tempsRealiseMinutes).toBe(492);

    const deleted = await server.inject({ method: "DELETE", url: `/api/brm/${event.id}`, headers: { cookie } });
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await server.inject({ method: "GET", url: "/api/brm", headers: { cookie } });
    expect(afterDelete.json().events).toEqual([]);
  });

  it("rejette une distance invalide", async () => {
    const cookie = await registerAndLogin(server, `brm-invalid-${Date.now()}@example.com`);
    const res = await server.inject({
      method: "POST",
      url: "/api/brm",
      headers: { cookie },
      payload: { distance: 250, date: "2027-02-14T06:00:00.000Z", lieu: "Rambouillet" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("isole les BRM entre utilisateurs", async () => {
    const cookieA = await registerAndLogin(server, `brm-a-${Date.now()}@example.com`);
    const cookieB = await registerAndLogin(server, `brm-b-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/brm",
      headers: { cookie: cookieA },
      payload: { distance: 300, date: "2027-03-21T06:00:00.000Z", lieu: "Longny-au-Perche" },
    });
    const eventId = created.json().event.id;

    const listB = await server.inject({ method: "GET", url: "/api/brm", headers: { cookie: cookieB } });
    expect(listB.json().events).toEqual([]);

    const patchB = await server.inject({
      method: "PATCH",
      url: `/api/brm/${eventId}`,
      headers: { cookie: cookieB },
      payload: { status: "fait" },
    });
    expect(patchB.statusCode).toBe(404);

    const deleteB = await server.inject({ method: "DELETE", url: `/api/brm/${eventId}`, headers: { cookie: cookieB } });
    expect(deleteB.statusCode).toBe(404);
  });
});
