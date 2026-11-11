import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-webhooks.db");

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let generateOpaqueToken: typeof import("../src/lib/tokens.js").generateOpaqueToken;
let hashToken: typeof import("../src/lib/tokens.js").hashToken;
let SESSION_COOKIE: typeof import("../src/lib/session.js").SESSION_COOKIE;

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
}

// Réponse ACP factice (même forme que la vraie API, voir src/lib/acpCatalog.ts) —
// nécessaire ici car déclencher "brm.participation_changed" (voir brmCatalog.ts)
// passe par un second appel au catalogue ACP pour retrouver les infos de
// l'événement, en plus de la livraison du webhook lui-même.
const FAKE_ACP_EVENT = {
  Date: "01/03/2027",
  Distance: 200,
  Pays: "France",
  SiteWeb: "",
  Ville: "Test",
  Departement: "Test",
  Region: "Test",
  RoadMap: "",
  Denivele: 1000,
  Contact: "",
  NomClub: "Club Webhook Test",
};

beforeAll(async () => {
  cleanupDbFiles();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "55".repeat(32);
  process.env.COOKIE_SECURE = "false";
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
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

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  const password = "mot-de-passe-de-test-123";
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Test" } });
  // Les routes webhooks sont réservées à l'administrateur (voir App.tsx / webhooks.ts) :
  // les comptes de test doivent l'être pour exercer ces routes.
  await prisma.user.update({ where: { email }, data: { isAdmin: true } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

describe("API Webhooks", () => {
  let server: ReturnType<typeof buildServer>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    server = buildServer();
  });

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      // Appel interne au catalogue ACP (voir brmCatalog.ts) : toute autre URL est
      // une livraison de webhook, simplement acquittée.
      if (url.includes("audax-club-parisien")) {
        return new Response(JSON.stringify([FAKE_ACP_EVENT]), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    // Chaque test doit partir d'un registre de webhooks vide : triggerWebhooks diffuse
    // à TOUS les abonnements actifs, donc un abonnement oublié d'un test précédent
    // fausserait le compte d'appels des tests suivants.
    await prisma.webhookSubscription.deleteMany();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/webhooks" });
    expect(res.statusCode).toBe(401);
  });

  it("refuse l'accès à un utilisateur connecté mais non administrateur", async () => {
    // Session créée directement en base plutôt que via /api/auth/login : cette suite
    // enchaîne déjà le nombre maximum de connexions que le rate limit de /auth/login
    // autorise par IP (voir src/lib/rateLimit.ts) — passer par la route le ferait échouer.
    const email = `wh-non-admin-${Date.now()}@example.com`;
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "mot-de-passe-de-test-123", prenom: "Test" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = generateOpaqueToken();
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    const cookie = `${SESSION_COOKIE}=${token}`;

    const res = await server.inject({ method: "GET", url: "/api/webhooks", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("crée un webhook Discord, le liste, le supprime", async () => {
    const cookie = await registerAndLogin(server, `wh-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie },
      payload: { url: "https://discord.com/api/webhooks/123/abc", format: "discord", events: ["brm.participation_changed"] },
    });
    expect(created.statusCode).toBe(201);
    const webhook = created.json().webhook;
    expect(webhook.events).toEqual(["brm.participation_changed"]);
    expect(created.json().secret).toBeNull(); // pas de secret pour le format discord

    const list = await server.inject({ method: "GET", url: "/api/webhooks", headers: { cookie } });
    expect(list.json().webhooks).toHaveLength(1);

    const deleted = await server.inject({ method: "DELETE", url: `/api/webhooks/${webhook.id}`, headers: { cookie } });
    expect(deleted.statusCode).toBe(204);

    const listAfter = await server.inject({ method: "GET", url: "/api/webhooks", headers: { cookie } });
    expect(listAfter.json().webhooks).toEqual([]);
  });

  it("génère un secret pour le format generic, et ne le renvoie plus ensuite", async () => {
    const cookie = await registerAndLogin(server, `wh-generic-${Date.now()}@example.com`);
    const created = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie },
      payload: { url: "https://example.com/hook", format: "generic", events: ["brm.participation_changed"] },
    });
    expect(created.json().secret).toMatch(/^[0-9a-f]{64}$/);

    const list = await server.inject({ method: "GET", url: "/api/webhooks", headers: { cookie } });
    expect(list.json().webhooks[0]).not.toHaveProperty("secret");
  });

  it("rejette une url non https et un événement invalide", async () => {
    const cookie = await registerAndLogin(server, `wh-bad-${Date.now()}@example.com`);
    const res1 = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie },
      payload: { url: "http://example.com/hook", format: "generic", events: ["brm.participation_changed"] },
    });
    expect(res1.statusCode).toBe(400);

    const res2 = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie },
      payload: { url: "https://example.com/hook", format: "generic", events: ["pas-un-event"] },
    });
    expect(res2.statusCode).toBe(400);
  });

  it("isole les webhooks entre utilisateurs", async () => {
    const a = await registerAndLogin(server, `wh-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `wh-b-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie: a },
      payload: { url: "https://example.com/hook-a", format: "discord", events: ["brm.participation_changed"] },
    });
    const id = created.json().webhook.id;

    const listB = await server.inject({ method: "GET", url: "/api/webhooks", headers: { cookie: b } });
    expect(listB.json().webhooks).toEqual([]);

    const deleteB = await server.inject({ method: "DELETE", url: `/api/webhooks/${id}`, headers: { cookie: b } });
    expect(deleteB.statusCode).toBe(404);
  });

  it("diffuse brm.participation_changed aux webhooks abonnés à cet événement, pas aux autres", async () => {
    const a = await registerAndLogin(server, `wh-broadcast-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `wh-broadcast-b-${Date.now()}@example.com`);

    await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie: a },
      payload: { url: "https://discord.com/api/webhooks/aaa", format: "discord", events: ["brm.participation_changed"] },
    });
    await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie: b },
      payload: { url: "https://discord.com/api/webhooks/bbb", format: "discord", events: ["meteo.vent_fort"] },
    });

    // Récupère l'id stable de l'événement ACP factice, comme le ferait le calendrier.
    const catalogRes = await server.inject({ method: "GET", url: "/api/brm/catalog", headers: { cookie: a } });
    const eventId = catalogRes.json().events[0].id;

    fetchMock.mockClear();
    const participation = await server.inject({
      method: "PUT",
      url: `/api/brm/catalog/${eventId}/participation`,
      headers: { cookie: a },
      payload: { status: "prevu" },
    });
    expect(participation.statusCode).toBe(200);

    // triggerWebhooks n'est pas attendu par la route : on laisse le event loop tourner.
    await new Promise((r) => setTimeout(r, 50));

    const discordCalls = fetchMock.mock.calls.filter(([url]: any[]) => url.includes("discord.com"));
    expect(discordCalls).toHaveLength(1); // seul le webhook de A écoute brm.participation_changed
    const [url, init] = discordCalls[0];
    expect(url).toBe("https://discord.com/api/webhooks/aaa");
    const body = JSON.parse(init.body as string);
    expect(body.content).toContain("Test"); // ville de l'événement ACP factice
    expect(init.headers["x-pbp-signature"]).toBeUndefined(); // pas de signature pour discord
  });

  it("le test manuel ne notifie que le webhook ciblé, pas les autres", async () => {
    const a = await registerAndLogin(server, `wh-test-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `wh-test-b-${Date.now()}@example.com`);

    const createdA = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie: a },
      payload: { url: "https://discord.com/api/webhooks/testa", format: "discord", events: ["brm.participation_changed"] },
    });
    await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie: b },
      payload: { url: "https://discord.com/api/webhooks/testb", format: "discord", events: ["brm.participation_changed"] },
    });

    fetchMock.mockClear();
    const testRes = await server.inject({
      method: "POST",
      url: `/api/webhooks/${createdA.json().webhook.id}/test`,
      headers: { cookie: a },
    });
    expect(testRes.statusCode).toBe(200);
    expect(testRes.json().lastStatus).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.com/api/webhooks/testa");
  });

  it("signe le payload generic en HMAC-SHA256 avec le secret de l'abonnement", async () => {
    const cookie = await registerAndLogin(server, `wh-hmac-${Date.now()}@example.com`);
    const created = await server.inject({
      method: "POST",
      url: "/api/webhooks",
      headers: { cookie },
      payload: { url: "https://example.com/hook", format: "generic", events: ["brm.participation_changed"] },
    });
    const webhook = created.json().webhook;

    fetchMock.mockClear();
    await server.inject({
      method: "POST",
      url: `/api/webhooks/${webhook.id}/test`,
      headers: { cookie },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-pbp-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    const payload = JSON.parse(init.body as string);
    expect(payload.event).toBe("brm.participation_changed");
  });
});
