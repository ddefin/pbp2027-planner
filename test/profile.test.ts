import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-profile.db");

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

const PASSWORD = "mot-de-passe-de-test-123";

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: PASSWORD, prenom: "Test" } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

describe("API Profil", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    cleanupDbFiles();
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.MFA_ENCRYPTION_KEY = "66".repeat(32);
    process.env.COOKIE_SECURE = "false";
    execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

    ({ buildServer } = await import("../src/server.js"));
    ({ prisma } = await import("../src/db.js"));
    server = buildServer();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    cleanupDbFiles();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/profile" });
    expect(res.statusCode).toBe(401);
  });

  it("lit et met à jour le profil (prénom, licence, club, carnet)", async () => {
    const cookie = await registerAndLogin(server, `profile-a-${Date.now()}@example.com`);

    const getRes = await server.inject({ method: "GET", url: "/api/profile", headers: { cookie } });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ prenom: "Test", licenceNumero: null, club: null, notebook: null });

    const patchRes = await server.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie },
      payload: { prenom: "Testine", licenceNumero: "FFCT-12345", club: "Vélo Club Paname", notebook: "Prendre les lumières." },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({
      prenom: "Testine",
      licenceNumero: "FFCT-12345",
      club: "Vélo Club Paname",
      notebook: "Prendre les lumières.",
    });

    // Persisté : un second GET renvoie bien les mêmes valeurs.
    const getAgain = await server.inject({ method: "GET", url: "/api/profile", headers: { cookie } });
    expect(getAgain.json().licenceNumero).toBe("FFCT-12345");
  });

  it("change le mot de passe avec l'ancien mot de passe correct, refuse sinon", async () => {
    const email = `profile-pw-${Date.now()}@example.com`;
    const cookie = await registerAndLogin(server, email);

    const wrong = await server.inject({
      method: "POST",
      url: "/api/profile/change-password",
      headers: { cookie },
      payload: { currentPassword: "mauvais-mot-de-passe", newPassword: "nouveau-mot-de-passe-456" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe("invalid_current_password");

    const ok = await server.inject({
      method: "POST",
      url: "/api/profile/change-password",
      headers: { cookie },
      payload: { currentPassword: PASSWORD, newPassword: "nouveau-mot-de-passe-456" },
    });
    expect(ok.statusCode).toBe(200);

    // L'ancien mot de passe ne fonctionne plus, le nouveau si.
    const loginOld = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
    expect(loginOld.statusCode).toBe(401);
    const loginNew = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "nouveau-mot-de-passe-456" } });
    expect(loginNew.statusCode).toBe(200);
  });

  it("gère les événements personnels, isolés par utilisateur", async () => {
    const cookieA = await registerAndLogin(server, `profile-events-a-${Date.now()}@example.com`);
    const cookieB = await registerAndLogin(server, `profile-events-b-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/profile/events",
      headers: { cookie: cookieA },
      payload: { title: "Sortie longue", date: "2027-05-01", notes: "Prévoir les barres de céréales" },
    });
    expect(created.statusCode).toBe(201);
    const event = created.json().event;
    expect(event.title).toBe("Sortie longue");

    // Visible par A.
    const listA = await server.inject({ method: "GET", url: "/api/profile/events", headers: { cookie: cookieA } });
    expect(listA.json().events).toHaveLength(1);

    // Invisible par B — isolation stricte, contrairement aux Sorties/calendrier BRM.
    const listB = await server.inject({ method: "GET", url: "/api/profile/events", headers: { cookie: cookieB } });
    expect(listB.json().events).toHaveLength(0);

    // B ne peut ni modifier ni supprimer l'événement de A.
    const deleteByB = await server.inject({ method: "DELETE", url: `/api/profile/events/${event.id}`, headers: { cookie: cookieB } });
    expect(deleteByB.statusCode).toBe(404);

    const deleteByA = await server.inject({ method: "DELETE", url: `/api/profile/events/${event.id}`, headers: { cookie: cookieA } });
    expect(deleteByA.statusCode).toBe(204);

    const listAfter = await server.inject({ method: "GET", url: "/api/profile/events", headers: { cookie: cookieA } });
    expect(listAfter.json().events).toHaveLength(0);
  });
});
