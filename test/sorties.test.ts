import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-sorties.db");

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
  process.env.MFA_ENCRYPTION_KEY = "33".repeat(32);
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

describe("API Sorties", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/sorties" });
    expect(res.statusCode).toBe(401);
  });

  it("crée une sortie, l'auteur y est automatiquement inscrit", async () => {
    const { cookie } = await registerAndLogin(server, `sortie-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/sorties",
      headers: { cookie },
      payload: { titre: "Sortie reco", date: "2027-02-01T07:00:00.000Z", lieu: "Rambouillet" },
    });
    expect(created.statusCode).toBe(201);
    const sortie = created.json().sortie;
    expect(sortie.joined).toBe(true);
    expect(sortie.participants).toHaveLength(1);

    const list = await server.inject({ method: "GET", url: "/api/sorties", headers: { cookie } });
    expect(list.json().sorties.some((s: { id: string }) => s.id === sortie.id)).toBe(true);
  });

  it("permet à un autre randonneur de rejoindre puis de se retirer", async () => {
    const a = await registerAndLogin(server, `sortie-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `sortie-b-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/sorties",
      headers: { cookie: a.cookie },
      payload: { titre: "Sortie nuit", date: "2027-03-01T18:00:00.000Z", lieu: "Chartres" },
    });
    const sortieId = created.json().sortie.id;

    const join = await server.inject({ method: "POST", url: `/api/sorties/${sortieId}/join`, headers: { cookie: b.cookie } });
    expect(join.statusCode).toBe(200);

    const listForB = await server.inject({ method: "GET", url: "/api/sorties", headers: { cookie: b.cookie } });
    const sortieForB = listForB.json().sorties.find((s: { id: string }) => s.id === sortieId);
    expect(sortieForB.joined).toBe(true);
    expect(sortieForB.participants).toHaveLength(2);

    const leave = await server.inject({ method: "DELETE", url: `/api/sorties/${sortieId}/join`, headers: { cookie: b.cookie } });
    expect(leave.statusCode).toBe(204);

    const listAfter = await server.inject({ method: "GET", url: "/api/sorties", headers: { cookie: b.cookie } });
    const sortieAfter = listAfter.json().sorties.find((s: { id: string }) => s.id === sortieId);
    expect(sortieAfter.joined).toBe(false);
    expect(sortieAfter.participants).toHaveLength(1);
  });

  it("rejette une sortie invalide", async () => {
    const { cookie } = await registerAndLogin(server, `sortie-bad-${Date.now()}@example.com`);
    const res = await server.inject({
      method: "POST",
      url: "/api/sorties",
      headers: { cookie },
      payload: { titre: "", date: "pas-une-date", lieu: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Chat WebSocket d'une sortie", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
  });

  it("refuse la connexion sans cookie de session", async () => {
    const { cookie } = await registerAndLogin(server, `chat-setup-${Date.now()}@example.com`);
    const created = await server.inject({
      method: "POST",
      url: "/api/sorties",
      headers: { cookie },
      payload: { titre: "Sortie chat", date: "2027-04-01T07:00:00.000Z", lieu: "Gacé" },
    });
    const sortieId = created.json().sortie.id;

    await expect(server.injectWS(`/api/sorties/${sortieId}/chat`)).rejects.toThrow();
  });

  it("diffuse un message en temps réel à tous les participants connectés, et le persiste", async () => {
    const a = await registerAndLogin(server, `chat-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `chat-b-${Date.now()}@example.com`);

    const created = await server.inject({
      method: "POST",
      url: "/api/sorties",
      headers: { cookie: a.cookie },
      payload: { titre: "Sortie chat live", date: "2027-05-01T07:00:00.000Z", lieu: "Longny-au-Perche" },
    });
    const sortieId = created.json().sortie.id;
    await server.inject({ method: "POST", url: `/api/sorties/${sortieId}/join`, headers: { cookie: b.cookie } });

    const wsA = await server.injectWS(`/api/sorties/${sortieId}/chat`, { headers: { cookie: a.cookie } });
    const wsB = await server.injectWS(`/api/sorties/${sortieId}/chat`, { headers: { cookie: b.cookie } });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      wsB.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString())));
    });

    wsA.send(JSON.stringify({ text: "On part à 7h tapantes" }));
    const message = await received;

    expect(message.type).toBe("message");
    expect(message.text).toBe("On part à 7h tapantes");
    expect(message.who).toBe(a.publicName);

    wsA.terminate();
    wsB.terminate();

    const history = await server.inject({
      method: "GET",
      url: `/api/sorties/${sortieId}/messages`,
      headers: { cookie: a.cookie },
    });
    const messages = history.json().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("On part à 7h tapantes");
    expect(messages[0].who).toBe(a.publicName);
  });
});
