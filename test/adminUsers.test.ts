import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-admin-users.db");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "a1".repeat(32);
  process.env.COOKIE_SECURE = "false";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("Espace admin : liste, fiche et vue d'ensemble", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  const DAY = 86_400_000;
  const get = (url: string) => server.inject({ method: "GET", url, headers: { cookie } });

  beforeAll(async () => {
    server = buildServer();
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: "chef@example.com", password: PASSWORD, prenom: "Chef" } });
    await prisma.user.update({ where: { email: "chef@example.com" }, data: { isAdmin: true } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "chef@example.com", password: PASSWORD } });
    const raw = res.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      await prisma.user.create({
        data: {
          email: `membre${String(i).padStart(2, "0")}@example.com`,
          prenom: i === 3 ? "Pascal" : `Membre${i}`,
          passwordHash: "x",
          club: i % 2 ? "Audax" : null,
          createdAt: new Date(now - i * DAY),
          suspendedAt: i === 5 ? new Date() : null,
          lockedUntil: i === 6 ? new Date(now + 600_000) : null,
        },
      });
    }
    await prisma.user.create({ data: { email: "membre-supprime@system.invalid", prenom: "Membre supprimé", passwordHash: "!", isSystem: true, suspendedAt: new Date(0) } });
  });

  it("pagine côté serveur et n'expose jamais le compte système", async () => {
    const p1 = (await get("/api/admin/users?pageSize=10&page=1")).json();
    expect(p1.total).toBe(26); // 25 membres + l'admin, sans le compte système
    expect(p1.items).toHaveLength(10);
    const p3 = (await get("/api/admin/users?pageSize=10&page=3")).json();
    expect(p3.items).toHaveLength(6);
    const all = [...p1.items, ...(await get("/api/admin/users?pageSize=10&page=2")).json().items, ...p3.items];
    expect(new Set(all.map((u: { id: string }) => u.id)).size).toBe(26);
    expect(JSON.stringify(all)).not.toContain("system.invalid");
    expect(JSON.stringify(p1)).not.toContain("passwordHash");
  });

  it("recherche (prénom, e-mail, club), filtre par statut et rôle, trie", async () => {
    expect((await get("/api/admin/users?q=pascal")).json().items.map((u: { prenom: string }) => u.prenom)).toEqual(["Pascal"]);
    expect((await get("/api/admin/users?q=MEMBRE07")).json().total).toBe(1);
    expect((await get("/api/admin/users?q=audax")).json().total).toBe(12);
    const sus = (await get("/api/admin/users?status=suspended")).json();
    expect(sus.items.map((u: { email: string; status: string }) => [u.email, u.status])).toEqual([["membre05@example.com", "suspended"]]);
    expect((await get("/api/admin/users?status=locked")).json().items[0].status).toBe("locked");
    expect((await get("/api/admin/users?status=active")).json().total).toBe(24);
    expect((await get("/api/admin/users?role=admin")).json().items.map((u: { email: string }) => u.email)).toEqual(["chef@example.com"]);
    const byName = (await get("/api/admin/users?sort=prenom&dir=asc&pageSize=100")).json().items.map((u: { prenom: string }) => u.prenom);
    expect(byName).toEqual([...byName].sort((a: string, b: string) => (a < b ? -1 : 1)));
    const seen = (await get("/api/admin/users?sort=lastSeenAt&dir=desc&pageSize=5")).json();
    expect(seen.items[0].email).toBe("chef@example.com"); // seul compte avec une session
  });

  it("refuse les paramètres hors liste (tri arbitraire, taille de page démesurée)", async () => {
    expect((await get("/api/admin/users?sort=passwordHash")).statusCode).toBe(400);
    expect((await get("/api/admin/users?pageSize=100000")).statusCode).toBe(400);
    expect((await get("/api/admin/users?status=tous")).statusCode).toBe(400);
  });

  it("donne la fiche d'un compte, et 404 pour le compte système ou un identifiant inconnu", async () => {
    const pascal = await prisma.user.findUniqueOrThrow({ where: { email: "membre03@example.com" } });
    await prisma.authEvent.create({ data: { email: pascal.email, kind: "mail_failed", detail: "535 Authentication failed" } });
    await prisma.groupMessage.create({ data: { userId: pascal.id, text: "Salut" } });
    const d = (await get(`/api/admin/users/${pascal.id}`)).json();
    expect(d.user).toMatchObject({ prenom: "Pascal", status: "active", isAdmin: false });
    expect(d.data.messages).toBe(1);
    expect(d.events[0]).toMatchObject({ kind: "mail_failed", detail: "535 Authentication failed" });
    const sys = await prisma.user.findFirstOrThrow({ where: { isSystem: true } });
    expect((await get(`/api/admin/users/${sys.id}`)).statusCode).toBe(404);
    expect((await get("/api/admin/users/inconnu")).statusCode).toBe(404);
  });

  it("calcule les indicateurs et la série d'activité pour chaque période", async () => {
    for (const [period, len] of [["7d", 7], ["30d", 30], ["12m", 12]] as const) {
      const o = (await get(`/api/admin/overview?period=${period}`)).json();
      expect(o.series.length).toBeGreaterThanOrEqual(len);
      expect(o.series.length).toBeLessThanOrEqual(len + 1);
      expect(o.totals.members).toBe(26);
    }
    const o7 = (await get("/api/admin/overview?period=7d")).json();
    expect(o7.kpis.newUsers.value).toBe(8); // 7 membres créés sur les 7 derniers jours + l'admin
    expect(o7.kpis.activity.messages).toBe(1);
    expect(o7.series.reduce((s: number, b: { messages: number }) => s + b.messages, 0)).toBe(1);
    expect(o7.kpis.incidents.value).toBe(1);
    // Au-delà de la conservation du journal (60 j), pas de comparaison inventée.
    expect((await get("/api/admin/overview?period=12m")).json().kpis.incidents.change).toBeNull();
    expect((await get("/api/admin/overview?period=1y")).statusCode).toBe(400);
  });

  it("recherche globale (palette) : comptes, sans le compte système", async () => {
    const r = (await get("/api/admin/search?q=pasc")).json();
    expect(r.users.map((u: { prenom: string }) => u.prenom)).toEqual(["Pascal"]);
    expect((await get("/api/admin/search?q=supprim")).json().users).toEqual([]);
    expect((await get("/api/admin/search?q=a")).statusCode).toBe(400);
  });
});
