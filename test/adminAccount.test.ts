import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-admin-account.db");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let tokens: typeof import("../src/lib/tokens.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.PUBLIC_URL = "https://pbp.example";
  // Serveur SMTP volontairement injoignable : l'envoi échoue et la cause doit être journalisée.
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_FROM = "pbp@example.com";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  tokens = await import("../src/lib/tokens.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

describe("Page Administration : diagnostic d'un compte", () => {
  let server: ReturnType<typeof buildServer>;
  let adminCookie: string;
  let userCookie: string;
  const PASCAL = "pascal.test@example.sncf.fr";

  const cookieOf = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];

  beforeAll(async () => {
    server = buildServer();
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: "admin-diag@example.com", password: PASSWORD, prenom: "Didier" } });
    await prisma.user.update({ where: { email: "admin-diag@example.com" }, data: { isAdmin: true } });
    adminCookie = cookieOf((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-diag@example.com", password: PASSWORD } })).headers["set-cookie"]);
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: "randonneur-diag@example.com", password: PASSWORD, prenom: "Paul" } });
    userCookie = cookieOf((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "randonneur-diag@example.com", password: PASSWORD } })).headers["set-cookie"]);
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: PASCAL, password: PASSWORD, prenom: "Pascal" } });
  });

  it("refuse la page aux comptes qui ne sont pas administrateurs", async () => {
    const res = await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}`, headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(403);
    expect((await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}` })).statusCode).toBe(401);
  });

  it("retrouve un compte, ses liens valides et son état, sans jamais renvoyer le hash", async () => {
    const res = await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}`, headers: { cookie: adminCookie } });
    const body = res.json();
    expect(body.exists).toBe(true);
    expect(body.account).toMatchObject({ prenom: "Pascal", locked: false, activeResetLinks: 0 });
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toMatch(/\$2[aby]\$|argon/i);
  });

  it("dit clairement quand l'adresse n'a pas de compte", async () => {
    const body = (await server.inject({ method: "GET", url: "/api/admin/account?email=inconnu@example.com", headers: { cookie: adminCookie } })).json();
    expect(body.exists).toBe(false);
    expect(body.account).toBeNull();
  });

  it("journalise une demande de réinitialisation et la cause exacte de l'échec d'envoi", async () => {
    const res = await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: PASCAL } });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(async () => expect(await prisma.authEvent.count({ where: { email: PASCAL, kind: "mail_failed" } })).toBe(1), { timeout: 5000 });
    const body = (await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}`, headers: { cookie: adminCookie } })).json();
    const kinds = body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["reset_requested", "mail_failed"]));
    const failed = body.events.find((e: { kind: string }) => e.kind === "mail_failed");
    expect(failed.detail).toMatch(/ECONNREFUSED|connect/i);
    expect(body.account.activeResetLinks).toBe(1);
    expect(body.mail).toMatchObject({ configured: true, host: "127.0.0.1", from: "pbp@example.com" });
  });

  it("journalise une adresse sans compte sans rien envoyer, et répond pareil", async () => {
    const res = await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "fantome@example.com" } });
    expect(res.statusCode).toBe(202);
    const body = (await server.inject({ method: "GET", url: "/api/admin/account?email=fantome@example.com", headers: { cookie: adminCookie } })).json();
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(["reset_no_account"]);
  });

  it("journalise la réinitialisation réussie et le lien refusé", async () => {
    const token = tokens.generateOpaqueToken();
    const u = await prisma.user.findUniqueOrThrow({ where: { email: PASCAL } });
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: tokens.hashToken(token), expiresAt: new Date(Date.now() + 3600_000) } });
    expect((await server.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password: "nouveau-mot-de-passe-123" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password: "nouveau-mot-de-passe-123" } })).statusCode).toBe(401);
    const body = (await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}`, headers: { cookie: adminCookie } })).json();
    const kinds = body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("reset_ok");
    // Le jeton a été supprimé à l'usage : un second clic ne se rattache à aucune adresse.
    expect(await prisma.authEvent.count({ where: { email: "inconnu", kind: "reset_token_invalid" } })).toBeGreaterThanOrEqual(1);
  });

  it("journalise un verrouillage de compte", async () => {
    await prisma.user.update({ where: { email: PASCAL }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    expect((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: PASCAL, password: "nouveau-mot-de-passe-123" } })).statusCode).toBe(423);
    const body = (await server.inject({ method: "GET", url: `/api/admin/account?email=${PASCAL}`, headers: { cookie: adminCookie } })).json();
    expect(body.account.locked).toBe(true);
    expect(body.events.some((e: { kind: string }) => e.kind === "login_locked")).toBe(true);
  });
});
