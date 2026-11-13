import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-admin-security.db");
const uploadsDir = path.resolve(repoRoot, "data-test-admin-security");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let ADMIN_ROUTES: typeof import("../src/routes/admin/index.js").ADMIN_ROUTES;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "ef".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.PUBLIC_URL = "https://pbp.example";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  ({ ADMIN_ROUTES } = await import("../src/routes/admin/index.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("Espace admin : sécurité", () => {
  let server: ReturnType<typeof buildServer>;
  let admin: { id: string; cookie: string };
  let member: { id: string; cookie: string };

  const cookieOf = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
  async function account(email: string, prenom: string, isAdmin = false) {
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: PASSWORD, prenom } });
    const u = await prisma.user.update({ where: { email }, data: { isAdmin } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
    return { id: u.id, cookie: cookieOf(res.headers["set-cookie"]) };
  }
  const as = (who: { cookie: string }, method: "GET" | "POST", url: string, payload?: object, headers: Record<string, string> = {}) =>
    server.inject({ method, url, headers: { cookie: who.cookie, ...headers }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
    admin = await account("chef@example.com", "Chef", true);
    member = await account("membre@example.com", "Membre");
  });

  it("protège CHAQUE route admin déclarée : 401 sans session, 403 pour un membre", async () => {
    expect(ADMIN_ROUTES.length).toBeGreaterThanOrEqual(6);
    for (const r of ADMIN_ROUTES) {
      const url = r.url.replace(/:id/g, "abc");
      const anon = await server.inject({ method: r.method as "GET", url, payload: r.method === "GET" ? undefined : {} });
      expect(anon.statusCode, `${r.method} ${url} sans session`).toBe(401);
      const asMember = await server.inject({ method: r.method as "GET", url, headers: { cookie: member.cookie }, payload: r.method === "GET" ? undefined : {} });
      expect(asMember.statusCode, `${r.method} ${url} en membre`).toBe(403);
    }
  });

  it("refuse une modification venue d'un autre site (CSRF)", async () => {
    const victim = await account("cible-csrf@example.com", "Cible");
    const evil = await as(admin, "POST", `/api/admin/users/${victim.id}/suspend`, { reason: "attaque" }, { origin: "https://evil.example" });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toBe("bad_origin");
    const crossSite = await as(admin, "POST", `/api/admin/users/${victim.id}/suspend`, { reason: "attaque" }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.statusCode).toBe(403);
    const ok = await as(admin, "POST", `/api/admin/users/${victim.id}/suspend`, { reason: "test légitime" }, { origin: "https://pbp.example", "sec-fetch-site": "same-origin" });
    expect(ok.statusCode).toBe(200);
  });

  it("valide strictement les entrées", async () => {
    expect((await as(admin, "POST", `/api/admin/users/${member.id}/suspend`, { reason: "x" })).statusCode).toBe(400);
    expect((await as(admin, "POST", `/api/admin/users/${member.id}/suspend`, {})).statusCode).toBe(400);
    expect((await as(admin, "POST", "/api/admin/users/bulk", { action: "supprimer", ids: [member.id] })).statusCode).toBe(400);
    expect((await as(admin, "POST", "/api/admin/users/../../etc/suspend", { reason: "motif valable" })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("suspend pour de vrai : sessions coupées, connexion refusée, absent de la messagerie, audité", async () => {
    const pascal = await account("pascal@example.com", "Pascal");
    const res = await as(admin, "POST", `/api/admin/users/${pascal.id}/suspend`, { reason: "Compte partagé" });
    expect(res.statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: pascal.cookie } })).statusCode).toBe(401);
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pascal@example.com", password: PASSWORD } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe("account_suspended");
    // Mauvais mot de passe : on n'apprend PAS que le compte est suspendu.
    expect((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pascal@example.com", password: "faux-mot-de-passe-123" } })).json().error).toBe("invalid_credentials");
    const users = (await as(member, "GET", "/api/messaging/users")).json().users.map((u: { prenom: string }) => u.prenom);
    expect(users).not.toContain("Pascal");
    const log = await prisma.adminAuditLog.findFirst({ where: { action: "user.suspend", targetId: pascal.id } });
    expect(log).toMatchObject({ actorEmail: "chef@example.com", targetType: "user" });
    expect(JSON.parse(log!.metadata!)).toEqual({ reason: "Compte partagé" });
    // Réactivation
    expect((await as(admin, "POST", `/api/admin/users/${pascal.id}/unsuspend`, {})).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pascal@example.com", password: PASSWORD } })).statusCode).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { action: "user.unsuspend", targetId: pascal.id } })).toBe(1);
  });

  it("interdit de se suspendre soi-même et de retirer le dernier administrateur", async () => {
    expect((await as(admin, "POST", `/api/admin/users/${admin.id}/suspend`, { reason: "par erreur" })).json().error).toBe("cannot_target_self");
    expect((await as(admin, "POST", `/api/admin/users/${admin.id}/role`, { isAdmin: false, password: PASSWORD })).json().error).toBe("last_admin");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isAdmin).toBe(true);
  });

  it("exige le mot de passe pour changer un rôle, et coupe les sessions d'un admin rétrogradé", async () => {
    const paul = await account("paul@example.com", "Paul");
    expect((await as(admin, "POST", `/api/admin/users/${paul.id}/role`, { isAdmin: true, password: "mauvais-mot-de-passe" })).json().error).toBe("wrong_password");
    expect((await as(admin, "POST", `/api/admin/users/${paul.id}/role`, { isAdmin: true, password: PASSWORD })).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: paul.id } })).isAdmin).toBe(true);
    // Paul (admin) voit maintenant l'espace ; rétrogradé, sa session est coupée.
    expect((await as(paul, "GET", "/api/admin/account?email=paul@example.com")).statusCode).toBe(200);
    expect((await as(admin, "POST", `/api/admin/users/${paul.id}/role`, { isAdmin: false, password: PASSWORD })).statusCode).toBe(200);
    expect((await as(paul, "GET", "/api/admin/account?email=paul@example.com")).statusCode).toBe(401);
    expect(await prisma.adminAuditLog.count({ where: { targetId: paul.id, action: { in: ["user.promote", "user.demote"] } } })).toBe(2);
  });

  it("supprime un compte avec double confirmation, en anonymisant ses contributions au groupe", async () => {
    const lucie = await account("lucie@example.com", "Lucie");
    await prisma.groupMessage.create({ data: { userId: lucie.id, text: "Rendez-vous à 6 h au départ" } });
    await prisma.directMessage.create({ data: { senderId: lucie.id, recipientId: member.id, text: "Merci pour la trace" } });
    await prisma.personalEvent.create({ data: { userId: lucie.id, title: "Sortie perso", date: new Date() } });
    const del = (payload: object) => as(admin, "POST", `/api/admin/users/${lucie.id}/delete`, payload);

    expect((await del({ confirmEmail: "autre@example.com", password: PASSWORD })).json().error).toBe("confirmation_mismatch");
    expect((await del({ confirmEmail: "lucie@example.com", password: "mauvais-mot-de-passe" })).json().error).toBe("wrong_password");
    expect(await prisma.user.count({ where: { id: lucie.id } })).toBe(1);

    expect((await del({ confirmEmail: "LUCIE@example.com", password: PASSWORD })).statusCode).toBe(200);
    expect(await prisma.user.count({ where: { id: lucie.id } })).toBe(0);
    const sys = await prisma.user.findFirstOrThrow({ where: { isSystem: true } });
    expect(sys.prenom).toBe("Membre supprimé");
    expect(await prisma.groupMessage.count({ where: { userId: sys.id, text: "Rendez-vous à 6 h au départ" } })).toBe(1);
    expect(await prisma.directMessage.count({ where: { senderId: sys.id, recipientId: member.id } })).toBe(1);
    expect(await prisma.personalEvent.count({ where: { title: "Sortie perso" } })).toBe(0);
    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "user.delete", targetId: lucie.id } });
    expect(log.targetLabel).toBe("Lucie (lucie@example.com)");
    expect(JSON.parse(log.metadata!).anonymized.messages).toBe(1);
    // Le compte système ne peut ni se connecter, ni être visé par une action, ni recevoir de message.
    expect((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: sys.email, password: PASSWORD } })).json().error).toBe("invalid_credentials");
    expect((await as(admin, "POST", `/api/admin/users/${sys.id}/unsuspend`, {})).statusCode).toBe(404);
    expect((await as(member, "GET", "/api/messaging/users")).json().users.map((u: { prenom: string }) => u.prenom)).not.toContain("Membre supprimé");
  });

  it("interdit de se supprimer soi-même et limite les ré-authentifications", async () => {
    expect((await as(admin, "POST", `/api/admin/users/${admin.id}/delete`, { confirmEmail: "chef@example.com", password: PASSWORD })).json().error).toBe("cannot_target_self");
    // Compte créé directement en base : les connexions de ce fichier ont déjà épuisé la
    // limite de connexions par adresse IP (10 / 15 min).
    const target = await prisma.user.create({ data: { email: "cible-rl@example.com", prenom: "Cible", passwordHash: "x" } });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await as(admin, "POST", `/api/admin/users/${target.id}/role`, { isAdmin: true, password: "faux" })).statusCode);
    expect(codes).toContain(429);
  });

  it("n'écrit jamais de secret dans le journal", async () => {
    const all = await prisma.adminAuditLog.findMany();
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) expect(e.metadata ?? "").not.toContain(PASSWORD);
  });
});
