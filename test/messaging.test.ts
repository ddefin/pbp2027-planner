import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-messaging.db");

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
  process.env.MFA_ENCRYPTION_KEY = "44".repeat(32);
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

async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  const password = "mot-de-passe-de-test-123";
  const prenom = email.split("@")[0];
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return { cookie: extractCookie(loginRes.headers["set-cookie"]), publicName: prenom };
}

describe("messagerie", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
  });

  it("refuse le salon général sans cookie de session", async () => {
    await expect(server.injectWS("/api/messaging/general/chat")).rejects.toThrow();
  });

  it("diffuse un message du salon général à tous les connectés, et le persiste", async () => {
    const a = await registerAndLogin(server, `general-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `general-b-${Date.now()}@example.com`);

    const wsA = await server.injectWS("/api/messaging/general/chat", { headers: { cookie: a.cookie } });
    const wsB = await server.injectWS("/api/messaging/general/chat", { headers: { cookie: b.cookie } });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      wsB.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString())));
    });

    wsA.send(JSON.stringify({ text: "Bonjour tout le monde" }));
    const message = await received;

    expect(message.type).toBe("message");
    expect(message.text).toBe("Bonjour tout le monde");
    expect(message.who).toBe(a.publicName);

    wsA.terminate();
    wsB.terminate();

    const history = await server.inject({
      method: "GET",
      url: "/api/messaging/general/messages",
      headers: { cookie: a.cookie },
    });
    const messages = history.json().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Bonjour tout le monde");
  });

  it("liste les autres randonneurs sans exposer leur email", async () => {
    const a = await registerAndLogin(server, `users-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `users-b-${Date.now()}@example.com`);

    const res = await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: a.cookie } });
    const users = res.json().users as { id: string; prenom: string }[];

    expect(users.some((u) => u.prenom === b.publicName)).toBe(true);
    expect(users.some((u) => u.prenom === a.publicName)).toBe(false); // pas soi-même
    expect(JSON.stringify(users)).not.toContain("@example.com");
  });

  it("échange un message privé en temps réel, le persiste, et le marque lu à la lecture", async () => {
    const a = await registerAndLogin(server, `dm-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `dm-b-${Date.now()}@example.com`);

    const meA = await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: a.cookie } });
    const meB = await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: b.cookie } });
    void meA;

    // On retrouve l'id de B via la liste des randonneurs (jamais exposé ailleurs).
    const usersRes = await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: a.cookie } });
    const bId = (usersRes.json().users as { id: string; prenom: string }[]).find((u) => u.prenom === b.publicName)!.id;
    void meB;

    const wsA = await server.injectWS(`/api/messaging/dm/${bId}/chat`, { headers: { cookie: a.cookie } });

    const usersResB = await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: b.cookie } });
    const aId = (usersResB.json().users as { id: string; prenom: string }[]).find((u) => u.prenom === a.publicName)!.id;
    const wsB = await server.injectWS(`/api/messaging/dm/${aId}/chat`, { headers: { cookie: b.cookie } });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      wsB.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString())));
    });

    wsA.send(JSON.stringify({ text: "Salut, tu pars à quelle heure ?" }));
    const message = await received;

    expect(message.type).toBe("message");
    expect(message.text).toBe("Salut, tu pars à quelle heure ?");
    expect(message.who).toBe(a.publicName);

    wsA.terminate();
    wsB.terminate();

    const convos = await server.inject({ method: "GET", url: "/api/messaging/dm/conversations", headers: { cookie: b.cookie } });
    const conversations = convos.json().conversations as { peerId: string; unread: number }[];
    expect(conversations.find((c) => c.peerId === aId)?.unread).toBe(1);

    const history = await server.inject({ method: "GET", url: `/api/messaging/dm/${aId}/messages`, headers: { cookie: b.cookie } });
    expect(history.json().messages).toHaveLength(1);

    // La lecture de l'historique par le destinataire doit avoir marqué le message comme lu.
    const convosAfter = await server.inject({ method: "GET", url: "/api/messaging/dm/conversations", headers: { cookie: b.cookie } });
    const conversationsAfter = convosAfter.json().conversations as { peerId: string; unread: number }[];
    expect(conversationsAfter.find((c) => c.peerId === aId)?.unread).toBe(0);
  });

  it("refuse de s'envoyer un message privé à soi-même", async () => {
    const a = await registerAndLogin(server, `dm-self-${Date.now()}@example.com`);
    const meRes = await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: a.cookie } });
    void meRes;
    const usersRes = await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: a.cookie } });
    void usersRes;

    // On ne peut pas récupérer son propre id via /messaging/users (il s'exclut lui-même) ;
    // on utilise donc directement la table pour le test.
    const self = await prisma.user.findFirst({ where: { email: { contains: `dm-self-` } }, orderBy: { createdAt: "desc" } });

    await expect(server.injectWS(`/api/messaging/dm/${self!.id}/chat`, { headers: { cookie: a.cookie } })).rejects.toThrow();
  });
});
