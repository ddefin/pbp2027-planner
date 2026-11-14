import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-avatars.db");
const uploadsDir = path.resolve(repoRoot, "data-test-avatars");
const PASSWORD = "mot-de-passe-de-test-123";

let buildServer: typeof import("../src/server.js").buildServer;
let prisma: typeof import("../src/db.js").prisma;
let avatarLib: typeof import("../src/lib/avatar.js");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
}

// JPEG minimal : JFIF (gardé), EXIF avec une position GPS (à retirer), commentaire (à retirer), données.
const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
const jpegWithGps = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")),
  seg(0xe1, Buffer.from("Exif\0\0GPS-48.8566N-2.3522E-SECRET", "binary")),
  seg(0xfe, Buffer.from("commentaire-prive", "binary")),
  seg(0xdb, Buffer.alloc(65, 1)),
  Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]),
]);
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
};
const pngWithText = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13, 1)), chunk("tEXt", Buffer.from("Location\0chez-moi-SECRET")), chunk("IDAT", Buffer.alloc(10, 7)), chunk("IEND", Buffer.alloc(0))]);

function multipart(name: string, content: Buffer, type = "image/jpeg") {
  const boundary = "----av" + Math.random().toString(16).slice(2);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  cleanup();
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "d4".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.UPLOADS_DIR = uploadsDir;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
  avatarLib = await import("../src/lib/avatar.js");
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanup();
});

describe("Avatars", () => {
  let server: ReturnType<typeof buildServer>;
  let a: string;
  let b: string;
  let admin: string;
  const cookieOf = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
  async function account(email: string, prenom: string) {
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: PASSWORD, prenom } });
    return cookieOf((await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } })).headers["set-cookie"]);
  }
  const upload = (cookie: string, content: Buffer, name = "moi.jpg") => {
    const m = multipart(name, content);
    return server.inject({ method: "POST", url: "/api/profile/avatar/photo", headers: { cookie, ...m.headers }, payload: m.body });
  };
  const files = () => (existsSync(path.join(uploadsDir, "avatars")) ? readdirSync(path.join(uploadsDir, "avatars")) : []);

  beforeAll(async () => {
    server = buildServer();
    a = await account("alice@example.com", "Alice");
    b = await account("bob@example.com", "Bob");
    admin = await account("chef-av@example.com", "Chef");
    await prisma.user.update({ where: { email: "chef-av@example.com" }, data: { isAdmin: true } });
  });

  it("retire les métadonnées (GPS, texte) sans toucher à l'image", () => {
    const j = avatarLib.stripImageMetadata(jpegWithGps, "image/jpeg");
    expect(j.includes("SECRET")).toBe(false);
    expect(j.includes("commentaire-prive")).toBe(false);
    expect(j.includes("JFIF")).toBe(true);
    expect(j.subarray(-9)).toEqual(jpegWithGps.subarray(-9));
    const p = avatarLib.stripImageMetadata(pngWithText, "image/png");
    expect(p.includes("SECRET")).toBe(false);
    expect(p.includes("IDAT")).toBe(true);
    expect(avatarLib.sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });

  it("choisit un avatar illustré, sur des listes fermées", async () => {
    const ok = await server.inject({ method: "PUT", url: "/api/profile/avatar", headers: { cookie: a }, payload: { icon: "bike", color: "coral" } });
    expect(ok.json().avatar).toEqual({ kind: "preset", icon: "bike", color: "coral" });
    for (const bad of [{ icon: "bombe", color: "coral" }, { icon: "bike", color: "url(javascript:1)" }, {}]) {
      expect((await server.inject({ method: "PUT", url: "/api/profile/avatar", headers: { cookie: a }, payload: bad })).statusCode).toBe(400);
    }
    expect((await server.inject({ method: "PUT", url: "/api/profile/avatar", payload: { icon: "bike", color: "coral" } })).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: a } })).json().avatar).toEqual({ kind: "preset", icon: "bike", color: "coral" });
  });

  it("accepte une photo, la nettoie, et ne la sert qu'aux membres connectés", async () => {
    const res = await upload(a, jpegWithGps);
    expect(res.statusCode).toBe(200);
    const { avatar } = res.json();
    expect(avatar.kind).toBe("photo");
    expect(avatar.url).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]{16}\?v=\d+$/);
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" } });
    expect(avatar.url).not.toContain(alice.id); // jamais l'id du compte dans l'adresse
    expect(JSON.stringify(res.json())).not.toContain("avatars/1"); // ni le chemin du fichier

    const img = await server.inject({ method: "GET", url: avatar.url, headers: { cookie: b } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(img.headers["cache-control"])).toContain("private");
    expect(img.rawPayload.includes("SECRET")).toBe(false);
    expect((await server.inject({ method: "GET", url: avatar.url })).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: "/api/avatars/cle-inconnue-123", headers: { cookie: b } })).statusCode).toBe(404);
  });

  it("refuse ce qui n'est pas une image, et les fichiers trop lourds", async () => {
    expect((await upload(b, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), "x.jpg")).statusCode).toBe(415);
    expect((await upload(b, Buffer.from("MZ\x90\0programme"), "photo.png")).statusCode).toBe(415);
    const big = Buffer.concat([jpegWithGps.subarray(0, jpegWithGps.length - 2), Buffer.alloc(320 * 1024, 5), Buffer.from([0xff, 0xd9])]);
    expect((await upload(b, big)).statusCode).toBe(413);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "bob@example.com" } })).avatar).toBeNull();
  });

  it("efface l'ancienne photo du disque à chaque changement", async () => {
    expect(files()).toHaveLength(1);
    const first = (await server.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: a } })).json().avatar.url;
    const second = (await upload(a, pngWithText, "moi.png")).json().avatar.url;
    expect(second).not.toBe(first);
    expect(files()).toHaveLength(1);
    expect((await server.inject({ method: "GET", url: first, headers: { cookie: a } })).statusCode).toBe(404); // ancienne adresse morte
    expect((await server.inject({ method: "GET", url: second, headers: { cookie: a } })).headers["content-type"]).toBe("image/png");
    // Passage à un avatar illustré, puis retour aux initiales : plus aucun fichier.
    await server.inject({ method: "PUT", url: "/api/profile/avatar", headers: { cookie: a }, payload: { icon: "mountain", color: "blue" } });
    expect(files()).toHaveLength(0);
    expect((await server.inject({ method: "DELETE", url: "/api/profile/avatar", headers: { cookie: a } })).json().avatar).toBeNull();
  });

  it("montre l'avatar dans la messagerie, le calendrier et la console d'administration", async () => {
    await server.inject({ method: "PUT", url: "/api/profile/avatar", headers: { cookie: a }, payload: { icon: "sun", color: "amber" } });
    const expected = { kind: "preset", icon: "sun", color: "amber" };
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" } });
    await prisma.groupMessage.create({ data: { userId: alice.id, text: "Salut" } }); // les textes passent par le temps réel
    const msgs = (await server.inject({ method: "GET", url: "/api/messaging/general/messages", headers: { cookie: b } })).json().messages;
    expect(msgs.at(-1).avatar).toEqual(expected);
    const peers = (await server.inject({ method: "GET", url: "/api/messaging/users", headers: { cookie: b } })).json().users;
    expect(peers.find((u: { prenom: string }) => u.prenom === "Alice").avatar).toEqual(expected);
    expect(peers.find((u: { prenom: string }) => u.prenom === "Chef").avatar).toBeNull();
    const list = (await server.inject({ method: "GET", url: "/api/admin/users?q=alice", headers: { cookie: admin } })).json().items;
    expect(list[0].avatar).toEqual(expected);
    expect(JSON.stringify(list)).not.toContain("avatarKey");
    const found = (await server.inject({ method: "GET", url: "/api/admin/search?q=alice", headers: { cookie: admin } })).json().users;
    expect(found[0].avatar).toEqual(expected);
  });

  it("efface la photo quand le compte est supprimé", async () => {
    await upload(b, jpegWithGps);
    expect(files()).toHaveLength(1);
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: "bob@example.com" } });
    const del = await server.inject({ method: "POST", url: `/api/admin/users/${bob.id}/delete`, headers: { cookie: admin }, payload: { confirmEmail: "bob@example.com", password: PASSWORD } });
    expect(del.statusCode).toBe(200);
    expect(files()).toHaveLength(0);
  });
});
