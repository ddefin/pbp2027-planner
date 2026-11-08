import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-password-reset.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

const sendMailMock = vi.fn().mockResolvedValue(undefined);

// Mocké au niveau module (hissé par vitest avant les imports) : évite toute vraie
// tentative de connexion SMTP pendant les tests.
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

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

describe("Mot de passe oublié", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    cleanupDbFiles();
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.MFA_ENCRYPTION_KEY = "88".repeat(32);
    process.env.COOKIE_SECURE = "false";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "no-reply@example.com";
    process.env.SMTP_PASSWORD = "test";
    execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

    ({ buildServer } = await import("../src/server.js"));
    ({ prisma } = await import("../src/db.js"));
    server = buildServer();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    cleanupDbFiles();
  });

  afterEach(() => {
    sendMailMock.mockClear();
  });

  it("envoie un email de réinitialisation pour un compte existant, et la même réponse générique sinon", async () => {
    const email = `forgot-${Date.now()}@example.com`;
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "mot-de-passe-de-test-123", prenom: "Test" } });

    const resExisting = await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email } });
    expect(resExisting.statusCode).toBe(202);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sentTo = sendMailMock.mock.calls[0][0].to;
    expect(sentTo).toBe(email);

    sendMailMock.mockClear();
    const resUnknown = await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: `inconnu-${Date.now()}@example.com` } });
    expect(resUnknown.statusCode).toBe(202);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("réinitialise le mot de passe avec le jeton reçu, invalide l'ancien mot de passe, et déconnecte les sessions existantes", async () => {
    const email = `reset-${Date.now()}@example.com`;
    const oldPassword = "ancien-mot-de-passe-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: oldPassword, prenom: "Test" } });

    const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: oldPassword } });
    const existingCookie = extractCookie(loginRes.headers["set-cookie"]);
    expect((await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: existingCookie } })).statusCode).toBe(200);

    await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email } });
    const resetUrl: string = sendMailMock.mock.calls[0][0].text;
    const token = new URL(resetUrl.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    const newPassword = "nouveau-mot-de-passe-456";
    const resetRes = await server.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password: newPassword } });
    expect(resetRes.statusCode).toBe(200);

    // L'ancien mot de passe ne fonctionne plus.
    const loginOld = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: oldPassword } });
    expect(loginOld.statusCode).toBe(401);

    // Le nouveau fonctionne.
    const loginNew = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: newPassword } });
    expect(loginNew.statusCode).toBe(200);

    // La session ouverte avant la réinitialisation a été coupée.
    const sessionAfter = await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: existingCookie } });
    expect(sessionAfter.statusCode).toBe(401);

    // Le jeton est à usage unique.
    const reuse = await server.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password: "encore-un-autre-789" } });
    expect(reuse.statusCode).toBe(401);
  });

  it("refuse un jeton invalide ou expiré", async () => {
    const res = await server.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token: "jeton-inexistant", password: "mot-de-passe-de-test-123" } });
    expect(res.statusCode).toBe(401);
  });
});
