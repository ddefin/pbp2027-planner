import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-admin-content.db");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "b2".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PASSWORD = "secret-smtp-ne-doit-pas-fuiter";
  process.env.TELEGRAM_BOT_TOKEN = "123:token-ne-doit-pas-fuiter";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("Espace admin : contenus, journaux, paramètres", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  let memberId: string;
  const get = (url: string) => server.inject({ method: "GET", url, headers: { cookie } });
  const post = (url: string, payload: object) => server.inject({ method: "POST", url, headers: { cookie }, payload });

  beforeAll(async () => {
    server = buildServer();
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: "chef@example.com", password: PASSWORD, prenom: "Chef" } });
    await prisma.user.update({ where: { email: "chef@example.com" }, data: { isAdmin: true } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "chef@example.com", password: PASSWORD } });
    const raw = res.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const m = await prisma.user.create({ data: { email: "lucie@example.com", prenom: "Lucie", passwordHash: "x" } });
    memberId = m.id;
    for (let i = 0; i < 12; i++) await prisma.groupMessage.create({ data: { userId: m.id, text: i === 4 ? "Annonce hors sujet à retirer" : `Message ${i}` } });
    await prisma.pbpRoute.create({ data: { label: "Variante perso", kind: "communautaire", fileName: "v.gpx", filePath: "pbp/inexistant.gpx", points: "[]", waypoints: "[]", distanceKm: 1219.6, rawPointCount: 10, uploadedByUserId: m.id } });
    await prisma.catalogTrack.create({ data: { catalogEventId: "acp-123", uploadedByUserId: m.id, fileName: "brm200.gpx", points: "[]", distanceKm: 203 } });
    await prisma.catalogTrackVariant.create({ data: { catalogEventId: "acp-123", uploadedByUserId: m.id, label: "Évite Nogent", fileName: "var.gpx", points: "[]" } });
  });

  it("liste et recherche les messages du groupe, paginés", async () => {
    const p = (await get("/api/admin/content/messages?pageSize=5")).json();
    expect(p.total).toBe(12);
    expect(p.items).toHaveLength(5);
    expect(p.items[0].author).toBe("Lucie (lucie@example.com)");
    expect((await get("/api/admin/content/messages?q=hors%20sujet")).json().total).toBe(1);
  });

  it("supprime un message avec un motif obligatoire, et l'inscrit au journal", async () => {
    const msg = await prisma.groupMessage.findFirstOrThrow({ where: { text: { contains: "hors sujet" } } });
    expect((await post(`/api/admin/content/messages/${msg.id}/delete`, { reason: "" })).statusCode).toBe(400);
    expect((await post(`/api/admin/content/messages/${msg.id}/delete`, { reason: "Hors sujet" })).statusCode).toBe(200);
    expect(await prisma.groupMessage.count({ where: { id: msg.id } })).toBe(0);
    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "content.delete", targetId: msg.id } });
    expect(log.targetLabel).toBe("Message de Lucie (lucie@example.com)");
    expect(JSON.parse(log.metadata!)).toMatchObject({ reason: "Hors sujet", excerpt: "Annonce hors sujet à retirer" });
    expect((await post(`/api/admin/content/messages/${msg.id}/delete`, { reason: "Encore" })).statusCode).toBe(404);
  });

  it("modère les tracés PBP et les traces de BRM (principale et variante)", async () => {
    const routes = (await get("/api/admin/content/pbp-routes")).json();
    expect(routes.items[0]).toMatchObject({ label: "Variante perso", kind: "communautaire", distanceKm: 1220 });
    expect((await post(`/api/admin/content/pbp-routes/${routes.items[0].id}/delete`, { reason: "Doublon du tracé officiel" })).statusCode).toBe(200);
    expect(await prisma.pbpRoute.count()).toBe(0);

    const tracks = (await get("/api/admin/content/brm-tracks")).json();
    expect(tracks.total).toBe(2);
    expect(tracks.items.map((t: { type: string }) => t.type).sort()).toEqual(["principale", "variante"]);
    for (const t of tracks.items) expect((await post(`/api/admin/content/brm-tracks/${t.id}/delete`, { reason: "Trace erronée" })).statusCode).toBe(200);
    expect(await prisma.catalogTrack.count()).toBe(0);
    expect(await prisma.catalogTrackVariant.count()).toBe(0);
    expect((await post("/api/admin/content/brm-tracks/x_abc/delete", { reason: "Trace erronée" })).statusCode).toBe(404);
  });

  it("journal d'audit : recherche et filtre par action, en lecture seule", async () => {
    const all = (await get("/api/admin/audit")).json();
    expect(all.total).toBe(4);
    expect((await get("/api/admin/audit?action=content.delete&q=doublon")).json().total).toBe(1);
    expect((await get("/api/admin/audit?action=user.inventee")).statusCode).toBe(400);
    // Aucune route ne permet de modifier ou d'effacer le journal.
    for (const method of ["DELETE", "PUT", "PATCH"] as const) {
      expect((await server.inject({ method, url: `/api/admin/audit`, headers: { cookie } })).statusCode).toBe(404);
    }
  });

  it("événements de compte, y compris pour une adresse sans compte", async () => {
    await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "pascal.inconnu@sncf.fr" } });
    const r = (await get("/api/admin/auth-events?q=pascal")).json();
    expect(r.items.map((e: { kind: string; email: string }) => [e.kind, e.email])).toEqual([["reset_no_account", "pascal.inconnu@sncf.fr"]]);
    expect((await get("/api/admin/auth-events?kind=login_ok")).json().items.every((e: { kind: string }) => e.kind === "login_ok")).toBe(true);
  });

  it("paramètres : état de la configuration, sans aucun secret", async () => {
    const res = await get("/api/admin/settings");
    const s = res.json();
    expect(s.mail).toMatchObject({ configured: true, host: "smtp.example.com" });
    expect(s.telegram.bot).toBe(true);
    expect(res.body).not.toContain("secret-smtp-ne-doit-pas-fuiter");
    expect(res.body).not.toContain("token-ne-doit-pas-fuiter");
    expect(res.body).not.toContain(process.env.MFA_ENCRYPTION_KEY!);
  });

  it("les contenus de groupe d'un membre supprimé restent, sous « Membre supprimé »", async () => {
    await post(`/api/admin/users/${memberId}/delete`, { confirmEmail: "lucie@example.com", password: PASSWORD });
    const p = (await get("/api/admin/content/messages?pageSize=100")).json();
    expect(p.total).toBe(11);
    expect(p.items.every((m: { author: string }) => m.author === "Membre supprimé")).toBe(true);
  });
});
