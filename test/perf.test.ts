import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Rapidité : réponses compressées, fichiers pré-compressés servis tels quels, cache long
// pour les lots à empreinte et revalidation pour index.html / service worker.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-perf.db");
const dist = path.resolve(repoRoot, "data-test-perf-dist");

let server: ReturnType<typeof import("../src/server.js").buildServer>;
let prisma: typeof import("../src/db.js").prisma;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
}

beforeAll(async () => {
  cleanup();
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  const js = `console.log(${JSON.stringify("x".repeat(5000))});`;
  writeFileSync(path.join(dist, "index.html"), `<!doctype html><title>t</title>${"<p>bonjour</p>".repeat(200)}`);
  writeFileSync(path.join(dist, "sw.js"), "self.addEventListener('install',()=>{});");
  writeFileSync(path.join(dist, "assets/index-abc123.js"), js);
  writeFileSync(path.join(dist, "assets/index-abc123.js.br"), brotliCompressSync(js));
  writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.MFA_ENCRYPTION_KEY = "12".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_DIST_PATH = dist;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });
  const { buildServer } = await import("../src/server.js");
  ({ prisma } = await import("../src/db.js"));
  server = buildServer();
});

afterAll(async () => {
  delete process.env.WEB_DIST_PATH;
  await server?.close();
  await prisma?.$disconnect();
  cleanup();
});

const get = (url: string, headers: Record<string, string> = { "accept-encoding": "br, gzip" }) => server.inject({ method: "GET", url, headers });

describe("Compression et cache", () => {
  it("sert le lot pré-compressé, gardé un an par le navigateur", async () => {
    const res = await get("/assets/index-abc123.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.rawPayload.length).toBeLessThan(500); // 5 Ko de texte répétitif
    const plain = await get("/assets/index-abc123.js", {});
    expect(plain.headers["content-encoding"]).toBeUndefined(); // navigateur sans compression : fichier brut
  });

  it("revalide toujours index.html et le service worker, y compris sur une route de l'appli", async () => {
    for (const url of ["/", "/calendrier", "/sw.js"]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
    expect((await get("/calendrier")).headers["content-encoding"]).toBe("br"); // HTML compressé à la volée
    expect((await get("/favicon.svg")).headers["cache-control"]).toBe("public, max-age=86400");
  });

  it("compresse les réponses JSON de l'API au-delà de 1 Ko, pas les petites", async () => {
    const email = `perf-${Date.now()}@example.com`;
    const password = "mot-de-passe-de-test-123";
    await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password, prenom: "Perf" } });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const raw = login.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw!).split(";")[0];
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.notification.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ userId: user.id, kind: "info", message: `Notification de test numéro ${i} avec un texte assez long pour peser` })) });
    const big = await get("/api/notifications", { cookie, "accept-encoding": "br, gzip" });
    expect(big.statusCode).toBe(200);
    expect(big.headers["content-encoding"]).toBe("br");
    const small = await get("/health");
    expect(small.headers["content-encoding"]).toBeUndefined();
    expect(small.json().status).toBe("ok");
  });
});
