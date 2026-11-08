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
  process.env.MFA_ENCRYPTION_KEY = "44".repeat(32);
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

function buildMultipartBody(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = "----testBoundary" + Date.now();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([pre, content, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Session créée directement en base plutôt que via /api/auth/login : cette suite
// enregistre largement plus de comptes que le rate limit de /auth/login n'autorise
// par IP sur la durée du test (voir src/lib/rateLimit.ts) — passer par la route
// ferait échouer les derniers tests du fichier.
async function registerAndLogin(server: ReturnType<typeof buildServer>, email: string) {
  const password = "mot-de-passe-de-test-123";
  const prenom = email.split("@")[0];
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = generateOpaqueToken();
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return { cookie: `${SESSION_COOKIE}=${token}`, publicName: prenom };
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

  it("partage une position dans le salon général, visible par tous", async () => {
    const a = await registerAndLogin(server, `loc-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `loc-b-${Date.now()}@example.com`);

    const res = await server.inject({
      method: "POST",
      url: "/api/messaging/general/location",
      headers: { cookie: a.cookie },
      payload: { lat: 48.8566, lon: 2.3522 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().message.kind).toBe("location");

    const history = await server.inject({ method: "GET", url: "/api/messaging/general/messages", headers: { cookie: b.cookie } });
    const loc = history.json().messages.find((m: { kind: string }) => m.kind === "location");
    expect(loc.lat).toBe(48.8566);
    expect(loc.lon).toBe(2.3522);
  });

  it("upload une pièce jointe dans le salon général, téléchargeable ensuite", async () => {
    const a = await registerAndLogin(server, `file-a-${Date.now()}@example.com`);

    const multipart = buildMultipartBody("file", "photo.jpg", "image/jpeg", Buffer.from("fake-jpeg-bytes"));
    const uploadRes = await server.inject({
      method: "POST",
      url: "/api/messaging/general/files",
      headers: { cookie: a.cookie, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    expect(uploadRes.statusCode).toBe(201);
    const message = uploadRes.json().message;
    expect(message.kind).toBe("file");
    expect(message.fileName).toBe("photo.jpg");

    const downloadRes = await server.inject({ method: "GET", url: `/api/messaging/general/files/${message.id}`, headers: { cookie: a.cookie } });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.body).toBe("fake-jpeg-bytes");
  });

  it("supprime son propre message du salon général, mais pas celui d'un autre", async () => {
    const a = await registerAndLogin(server, `del-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `del-b-${Date.now()}@example.com`);

    const res = await server.inject({
      method: "POST",
      url: "/api/messaging/general/location",
      headers: { cookie: a.cookie },
      payload: { lat: 1, lon: 1 },
    });
    const id = res.json().message.id;

    const deleteByB = await server.inject({ method: "DELETE", url: `/api/messaging/general/messages/${id}`, headers: { cookie: b.cookie } });
    expect(deleteByB.statusCode).toBe(403);

    const deleteByA = await server.inject({ method: "DELETE", url: `/api/messaging/general/messages/${id}`, headers: { cookie: a.cookie } });
    expect(deleteByA.statusCode).toBe(204);

    const history = await server.inject({ method: "GET", url: "/api/messaging/general/messages", headers: { cookie: a.cookie } });
    expect(history.json().messages.find((m: { id: string }) => m.id === id)).toBeUndefined();
  });

  it("supprime son propre message privé, mais pas celui du correspondant", async () => {
    const a = await registerAndLogin(server, `del-dm-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `del-dm-b-${Date.now()}@example.com`);
    const usersRes = await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: a.cookie } });
    const bId = (usersRes.json().users as { id: string; prenom: string }[]).find((u) => u.prenom === b.publicName)!.id;

    const res = await server.inject({
      method: "POST",
      url: `/api/messaging/dm/${bId}/location`,
      headers: { cookie: a.cookie },
      payload: { lat: 2, lon: 2 },
    });
    const id = res.json().message.id;

    const deleteByB = await server.inject({ method: "DELETE", url: `/api/messaging/dm/${bId}/messages/${id}`, headers: { cookie: b.cookie } });
    expect(deleteByB.statusCode).toBe(403);

    const deleteByA = await server.inject({ method: "DELETE", url: `/api/messaging/dm/${bId}/messages/${id}`, headers: { cookie: a.cookie } });
    expect(deleteByA.statusCode).toBe(204);
  });
});
