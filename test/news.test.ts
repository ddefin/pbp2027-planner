import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-news.db");

const acpHtml = readFileSync(path.resolve(__dirname, "fixtures/acp-actualites.html"), "utf8");
const pbpHtml = readFileSync(path.resolve(__dirname, "fixtures/pbp-actualites.html"), "utf8");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let scrapeNews: typeof import("../src/lib/newsScraper.js").scrapeNews;
let syncNewsNotifications: typeof import("../src/lib/newsScraper.js").syncNewsNotifications;
let generateOpaqueToken: typeof import("../src/lib/tokens.js").generateOpaqueToken;
let hashToken: typeof import("../src/lib/tokens.js").hashToken;
let SESSION_COOKIE: typeof import("../src/lib/session.js").SESSION_COOKIE;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "33".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_NEWS_CHAT_ID = "test-news-chat";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  ({ scrapeNews, syncNewsNotifications } = await import("../src/lib/newsScraper.js"));
  ({ generateOpaqueToken, hashToken } = await import("../src/lib/tokens.js"));
  ({ SESSION_COOKIE } = await import("../src/lib/session.js"));
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

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string, admin = false) {
  const password = "mot-de-passe-de-test-123";
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Test" } });
  if (admin) await prisma.user.update({ where: { email }, data: { isAdmin: true } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

describe("Scraping des actualités", () => {
  let server: ReturnType<typeof buildServer>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    server = buildServer();
  });

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes("audax-club-parisien.com/actualites")) return new Response(acpHtml, { status: 200 });
      if (url.includes("paris-brest-paris.org/actualites")) return new Response(pbpHtml, { status: 200 });
      if (url.includes("api.telegram.org")) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.newsItem.deleteMany();
  });

  it("extrait les articles des deux sites et les diffuse sur Telegram", async () => {
    const result = await scrapeNews();
    expect(result.checked).toBe(20); // 10 ACP + 10 PBP, voir les fixtures
    expect(result.added).toBe(20);

    const items = await prisma.newsItem.findMany();
    expect(items).toHaveLength(20);
    expect(items.some((i) => i.source === "acp")).toBe(true);
    expect(items.some((i) => i.source === "pbp")).toBe(true);
    // Une actualité PBP connue, pour vérifier titre/date/url/image correctement extraits.
    const known = items.find((i) => i.url.includes("pbp-stories-3-richard"));
    expect(known?.title).toBe("PBP Stories #3 : Richard");
    expect(known?.publishedAt.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(known?.imageUrl).toContain("richardext.jpg");

    const telegramCalls = fetchMock.mock.calls.filter(([url]: any[]) => String(url).includes("api.telegram.org/bot") && String(url).includes("sendMessage"));
    expect(telegramCalls).toHaveLength(20); // une diffusion par nouvel article
  });

  it("ne duplique jamais un article déjà vu (dédoublonnage par URL), même sur un 2e passage", async () => {
    await scrapeNews();
    fetchMock.mockClear();

    const second = await scrapeNews();
    expect(second.checked).toBe(20); // les pages sources listent toujours les mêmes 20 articles
    expect(second.added).toBe(0); // mais aucun n'est nouveau

    const items = await prisma.newsItem.findMany();
    expect(items).toHaveLength(20);

    const telegramCalls = fetchMock.mock.calls.filter(([url]: any[]) => String(url).includes("sendMessage"));
    expect(telegramCalls).toHaveLength(0); // rien de nouveau à rediffuser
  });

  it("crée une notification de cloche par compte pour les actualités récentes, sans doublon", async () => {
    const user = await prisma.user.create({ data: { email: `news-bell-${Date.now()}@example.com`, passwordHash: "x", prenom: "Cloche" } });
    await scrapeNews();
    // Le scraping crée lui-même les notifications (« maintenant » = date réelle du test).
    const now = new Date();
    const mine = await prisma.notification.findMany({ where: { userId: user.id, kind: "news" } });
    const recent = await prisma.newsItem.count({ where: { publishedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } });
    expect(mine.length).toBe(recent); // seulement les articles de moins de 7 jours
    expect(mine.every((n) => n.link === "/actualites")).toBe(true);
    if (recent > 0) expect(mine[0].message).toMatch(/^📰 /);
    expect(await syncNewsNotifications(now)).toBe(0); // idempotent
    // Un compte créé plus tard reçoit les actualités récentes au passage suivant.
    const late = await prisma.user.create({ data: { email: `news-late-${Date.now()}@example.com`, passwordHash: "x", prenom: "Tard" } });
    expect(await syncNewsNotifications(now)).toBe(recent);
    await prisma.notification.deleteMany({ where: { userId: late.id } });
    await prisma.user.delete({ where: { id: late.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("continue avec l'autre source si l'une des deux pages sources est injoignable", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("audax-club-parisien.com/actualites")) throw new Error("network down");
      if (url.includes("paris-brest-paris.org/actualites")) return new Response(pbpHtml, { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });

    const result = await scrapeNews();
    expect(result.checked).toBe(10); // seule la source PBP a répondu
    const items = await prisma.newsItem.findMany();
    expect(items.every((i) => i.source === "pbp")).toBe(true);
  });
});

describe("API Actualités", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("audax-club-parisien.com/actualites")) return new Response(acpHtml, { status: 200 });
        if (url.includes("paris-brest-paris.org/actualites")) return new Response(pbpHtml, { status: 200 });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.newsItem.deleteMany();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/news" });
    expect(res.statusCode).toBe(401);
  });

  it("liste les actualités, filtre par source et par recherche", async () => {
    await scrapeNews();
    const cookie = await registerAndLogin(server, `news-${Date.now()}@example.com`);

    const all = await server.inject({ method: "GET", url: "/api/news", headers: { cookie } });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(20);
    expect(all.json().lastUpdatedAt).not.toBeNull();

    const onlyAcp = await server.inject({ method: "GET", url: "/api/news?source=acp", headers: { cookie } });
    expect(onlyAcp.json().items.every((i: { source: string }) => i.source === "acp")).toBe(true);
    expect(onlyAcp.json().items).toHaveLength(10);

    const search = await server.inject({ method: "GET", url: "/api/news?q=Richard", headers: { cookie } });
    expect(search.json().items).toHaveLength(1);
    expect(search.json().items[0].title).toContain("Richard");
  });

  it("réserve /news/refresh à l'administrateur", async () => {
    const cookie = await registerAndLogin(server, `news-nonadmin-${Date.now()}@example.com`);
    const res = await server.inject({ method: "POST", url: "/api/news/refresh", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("permet à l'admin de déclencher un scraping immédiat", async () => {
    const cookie = await registerAndLogin(server, `news-admin-${Date.now()}@example.com`, true);
    const res = await server.inject({ method: "POST", url: "/api/news/refresh", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(20);
  });
});

describe("Liaison de compte Telegram", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  afterEach(async () => {
    await prisma.telegramLink.deleteMany();
    await prisma.telegramLinkCode.deleteMany();
  });

  it("génère un code, renvoie non-lié par défaut", async () => {
    const cookie = await registerAndLogin(server, `tg-${Date.now()}@example.com`);

    const status = await server.inject({ method: "GET", url: "/api/profile/telegram", headers: { cookie } });
    expect(status.json()).toMatchObject({ linked: false, linkedAt: null, configured: true });

    const codeRes = await server.inject({ method: "POST", url: "/api/profile/telegram/link-code", headers: { cookie } });
    expect(codeRes.statusCode).toBe(200);
    expect(codeRes.json().code).toMatch(/^[A-F0-9]{8}$/);
  });

  it("lie le compte quand /start <code> est reçu avec un code valide, puis le consomme", async () => {
    const { createTelegramLinkCode, handleTelegramStartCommand } = await import("../src/lib/telegramBot.js");
    const email = `tg-link-${Date.now()}@example.com`;
    const cookie = await registerAndLogin(server, email);

    const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { code } = await createTelegramLinkCode(userId);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })));
    await handleTelegramStartCommand("123456", code);
    vi.unstubAllGlobals();

    // Le code est consommé : un 2e envoi du même code ne doit plus rien lier.
    const codeAfter = await prisma.telegramLinkCode.findUnique({ where: { code } });
    expect(codeAfter).toBeNull();

    const after = await server.inject({ method: "GET", url: "/api/profile/telegram", headers: { cookie } });
    expect(after.json().linked).toBe(true);

    const unlink = await server.inject({ method: "DELETE", url: "/api/profile/telegram", headers: { cookie } });
    expect(unlink.statusCode).toBe(204);
    const afterUnlink = await server.inject({ method: "GET", url: "/api/profile/telegram", headers: { cookie } });
    expect(afterUnlink.json().linked).toBe(false);
  });

  it("ignore un code invalide ou expiré sans lier quoi que ce soit", async () => {
    const { handleTelegramStartCommand } = await import("../src/lib/telegramBot.js");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handleTelegramStartCommand("999999", "NOTACODE");
    vi.unstubAllGlobals();

    expect(await prisma.telegramLink.findUnique({ where: { chatId: "999999" } })).toBeNull();
    // Un message d'erreur a quand même été envoyé à l'utilisateur sur Telegram.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
