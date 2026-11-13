import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-admin-extras.db");
const hbDir = path.resolve(repoRoot, "data-test-admin-extras");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let presence: typeof import("../src/shared/presence.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(hbDir)) rmSync(hbDir, { recursive: true, force: true });
}

let telegram: { chatId: string; text: string }[] = [];

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "c3".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.PUBLIC_URL = "https://pbp.example";
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.BACKUP_HEARTBEAT_FILE = path.join(hbDir, ".last-backup");
  // Serveur mail injoignable : l'envoi échoue vite, avec une cause.
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_FROM = "pbp@example.com";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  presence = await import("../src/shared/presence.js");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  cleanup();
});

beforeEach(() => {
  telegram = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body));
        telegram.push({ chatId: String(body.chat_id), text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("Présence", () => {
  it("vert sous 5 min, orange jusqu'à 72 h, rouge au-delà ou jamais vu", () => {
    const now = new Date("2027-03-10T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(presence.presenceOf(ago(60_000), now)).toBe("online");
    expect(presence.presenceOf(ago(5 * 60_000 - 1), now)).toBe("online");
    expect(presence.presenceOf(ago(5 * 60_000), now)).toBe("recent");
    expect(presence.presenceOf(ago(71 * 3_600_000), now)).toBe("recent");
    expect(presence.presenceOf(ago(72 * 3_600_000), now)).toBe("away");
    expect(presence.presenceOf(null, now)).toBe("away");
  });
});

describe("Console admin : présence, à surveiller, lien de mot de passe, annonces", () => {
  let server: ReturnType<typeof buildServer>;
  let cookie: string;
  const ids: Record<string, string> = {};
  const get = (url: string) => server.inject({ method: "GET", url, headers: { cookie } });
  const post = (url: string, payload: object = {}) => server.inject({ method: "POST", url, headers: { cookie }, payload });

  beforeAll(async () => {
    server = buildServer();
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email: "chef@example.com", password: PASSWORD, prenom: "Chef" } });
    await prisma.user.update({ where: { email: "chef@example.com" }, data: { isAdmin: true } });
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "chef@example.com", password: PASSWORD } });
    const raw = res.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const now = Date.now();
    const mk = async (key: string, prenom: string, seenAgoMs: number | null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${key}@example.com`, prenom, passwordHash: "x", ...extra } });
      ids[key] = u.id;
      if (seenAgoMs !== null) await prisma.session.create({ data: { userId: u.id, tokenHash: `t-${key}`, expiresAt: new Date(now + 86_400_000), lastSeenAt: new Date(now - seenAgoMs) } });
    };
    await mk("enligne", "Élise", 60_000);
    await mk("hier", "Hugo", 20 * 3_600_000);
    await mk("absent", "Abel", 100 * 3_600_000);
    await mk("jamais", "Jade", null);
    await mk("suspendu", "Sam", null, { suspendedAt: new Date(), suspendedReason: "test" });
    await prisma.telegramLink.create({ data: { userId: ids.hier, chatId: "111" } });
    await prisma.telegramLink.create({ data: { userId: ids.suspendu, chatId: "222" } });
  });

  it("donne la présence de chaque compte et la filtre", async () => {
    const all = (await get("/api/admin/users?pageSize=100")).json().items as { email: string; presence: string }[];
    const by = Object.fromEntries(all.map((u) => [u.email.split("@")[0], u.presence]));
    expect(by).toMatchObject({ chef: "online", enligne: "online", hier: "recent", absent: "away", jamais: "away" });
    const names = async (p: string) => ((await get(`/api/admin/users?presence=${p}&pageSize=100`)).json().items as { prenom: string }[]).map((u) => u.prenom).sort();
    expect(await names("online")).toEqual(["Chef", "Élise"].sort());
    expect(await names("recent")).toEqual(["Hugo"]);
    expect(await names("away")).toEqual(["Abel", "Jade", "Sam"]);
    expect((await get("/api/admin/users?presence=fantome")).statusCode).toBe(400);
    expect((await get(`/api/admin/users/${ids.hier}`)).json().user.presence).toBe("recent");
    const o = (await get("/api/admin/overview")).json();
    expect(o.online.count).toBe(2);
    expect(o.online.users.map((u: { prenom: string }) => u.prenom).sort()).toEqual(["Chef", "Élise"].sort());
  });

  it("« À surveiller » : sauvegarde absente, mail échoué, compte verrouillé, Strava en erreur", async () => {
    await prisma.authEvent.create({ data: { email: "pascal@sncf.fr", kind: "mail_failed", detail: "535 Authentication failed" } });
    await prisma.authEvent.create({ data: { email: "ok@example.com", kind: "mail_failed", detail: "x", createdAt: new Date(Date.now() - 3_600_000) } });
    await prisma.authEvent.create({ data: { email: "ok@example.com", kind: "mail_sent" } }); // réussi depuis : plus à surveiller
    await prisma.user.update({ where: { id: ids.absent }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    await prisma.stravaAccount.create({ data: { userId: ids.hier, athleteId: "9", athleteName: "Hugo", accessToken: "a", refreshToken: "r", expiresAt: new Date(), scope: "read", lastSyncError: "Autorisation Strava expirée" } });
    const items = (await get("/api/admin/attention")).json().items as { kind: string; title: string; detail: string | null; link: string }[];
    expect(items.map((i) => i.kind).sort()).toEqual(["backup", "locked", "mail_failed", "strava"]);
    const mail = items.find((i) => i.kind === "mail_failed")!;
    expect(mail.title).toContain("pascal@sncf.fr");
    expect(mail.detail).toBe("535 Authentication failed");
    expect(items.find((i) => i.kind === "locked")!.link).toBe(`/admin/utilisateurs/${ids.absent}`);
    // Sauvegarde fraîche : le signal disparaît.
    mkdirSync(hbDir, { recursive: true });
    writeFileSync(path.join(hbDir, ".last-backup"), String(Math.floor(Date.now() / 1000)));
    expect(((await get("/api/admin/attention")).json().items as { kind: string }[]).some((i) => i.kind === "backup")).toBe(false);
  });

  it("envoie un lien de mot de passe : résultat exact, audit, jamais le lien dans la réponse", async () => {
    const res = await post(`/api/admin/users/${ids.jamais}/send-reset`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sent).toBe(false); // serveur mail injoignable dans ce test
    expect(body.error).toMatch(/ECONNREFUSED|connect/i);
    expect(res.body).not.toContain("token=");
    expect(await prisma.passwordResetToken.count({ where: { userId: ids.jamais } })).toBe(1);
    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "user.reset_link", targetId: ids.jamais } });
    expect(JSON.parse(log.metadata!).sent).toBe(false);
    expect(log.metadata).not.toContain("token=");
    expect(await prisma.authEvent.count({ where: { email: "jamais@example.com", kind: "mail_failed" } })).toBe(1);
    // Compte suspendu : refusé. Limite : 3 envois par heure et par compte.
    expect((await post(`/api/admin/users/${ids.suspendu}/send-reset`)).json().error).toBe("account_suspended");
    await post(`/api/admin/users/${ids.jamais}/send-reset`);
    await post(`/api/admin/users/${ids.jamais}/send-reset`);
    expect((await post(`/api/admin/users/${ids.jamais}/send-reset`)).statusCode).toBe(429);
  });

  it("annonce : cloche des membres actifs, Telegram des comptes liés, audit, validation", async () => {
    expect((await get("/api/admin/announcements/recipients")).json()).toEqual({ members: 5, telegram: 1 });
    expect((await post("/api/admin/announcements", { message: "x" })).statusCode).toBe(400);
    const res = await post("/api/admin/announcements", { message: "Sortie de reconnaissance <dimanche> 8 h", telegram: true });
    expect(res.json()).toEqual({ ok: true, recipients: 5, telegramSent: 1 });
    expect(await prisma.notification.count({ where: { kind: "announcement" } })).toBe(5);
    expect(await prisma.notification.count({ where: { kind: "announcement", userId: ids.suspendu } })).toBe(0);
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toMatchObject({ chatId: "111" });
    expect(telegram[0].text).toContain("&lt;dimanche&gt;"); // texte échappé pour Telegram
    const hist = (await get("/api/admin/announcements")).json().items;
    expect(hist[0]).toMatchObject({ actorEmail: "chef@example.com", message: "Sortie de reconnaissance <dimanche> 8 h", recipients: 5, telegramSent: 1 });
    // Sans Telegram : rien n'est envoyé.
    telegram = [];
    await post("/api/admin/announcements", { message: "Rappel : licences à jour" });
    expect(telegram).toHaveLength(0);
  });
});
