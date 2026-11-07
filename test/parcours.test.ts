import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-parcours.db");
const sampleGpxPath = path.resolve(__dirname, "fixtures/sample.gpx");

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
  process.env.MFA_ENCRYPTION_KEY = "66".repeat(32);
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
  await server.inject({ method: "POST", url: "/api/auth/register", payload: { email, password } });
  const loginRes = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return extractCookie(loginRes.headers["set-cookie"]);
}

async function createBrmEvent(server: ReturnType<typeof buildServer>, cookie: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/brm",
    headers: { cookie },
    payload: { distance: 200, date: "2027-02-14T06:00:00.000Z", lieu: "Rambouillet" },
  });
  return res.json().event.id as string;
}

function buildMultipartBody(fieldName: string, filename: string, contentType: string, content: Buffer) {
  const boundary = "----testBoundary" + Date.now();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([pre, content, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("API Parcours", () => {
  let server: ReturnType<typeof buildServer>;

  beforeAll(() => {
    server = buildServer();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>pas de __NUXT__ ici</html>", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuse l'accès sans session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/brm/whatever/parcours" });
    expect(res.statusCode).toBe(401);
  });

  it("renvoie 404 pour un BRM qui n'appartient pas à l'utilisateur", async () => {
    const a = await registerAndLogin(server, `pc-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `pc-b-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, a);

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/parcours`, headers: { cookie: b } });
    expect(res.statusCode).toBe(404);
  });

  it("n'a pas de parcours au départ, puis enregistre les notes", async () => {
    const cookie = await registerAndLogin(server, `pc-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const empty = await server.inject({ method: "GET", url: `/api/brm/${brmId}/parcours`, headers: { cookie } });
    expect(empty.json().parcours).toBeNull();

    const updated = await server.inject({
      method: "PUT",
      url: `/api/brm/${brmId}/parcours`,
      headers: { cookie },
      payload: {
        notes: "Ravito à Mortagne-au-Perche km 95, portion exposée au vent après le bois.",
      },
    });
    expect(updated.statusCode).toBe(200);
    const p = updated.json().parcours;
    expect(p.notes).toContain("Mortagne");
    expect(p.hasFile).toBe(false);
  });

  it("tente une récupération automatique quand un sourceUrl OpenRunner est fourni", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<html><script>window.__NUXT__=(function(a,b){x.id=42;x.name="Test Route";x.length=50000;x.elevation={ascent:a,descent:b,min:10,max:210,full_encoded:"..."};var x={}})(500,480);</script></html>`,
          { status: 200 },
        ),
      ),
    );

    const cookie = await registerAndLogin(server, `pc-auto-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const res = await server.inject({
      method: "PUT",
      url: `/api/brm/${brmId}/parcours`,
      headers: { cookie },
      payload: { sourceUrl: "https://www.openrunner.com/route-details/42" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().autoFetched).toBe(true);
    expect(res.json().parcours.distanceKm).toBe(50);
    expect(res.json().parcours.elevationGainM).toBe(500);
    expect(res.json().parcours.elevationLossM).toBe(480);
  });

  it("l'échec de récupération automatique n'empêche pas d'enregistrer le reste", async () => {
    // fetch mocké par défaut renvoie une page sans __NUXT__ exploitable -> autoFetched false.
    const cookie = await registerAndLogin(server, `pc-fail-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const res = await server.inject({
      method: "PUT",
      url: `/api/brm/${brmId}/parcours`,
      headers: { cookie },
      payload: { sourceUrl: "https://www.openrunner.com/route-details/999999", notes: "à uploader manuellement" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().autoFetched).toBe(false);
    expect(res.json().parcours.notes).toBe("à uploader manuellement");
  });

  it("upload un GPX, en calcule les stats, et permet de le re-télécharger", async () => {
    const cookie = await registerAndLogin(server, `pc-upload-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const gpxContent = readFileSync(sampleGpxPath);
    const { body, contentType } = buildMultipartBody("file", "mon-parcours.gpx", "application/gpx+xml", gpxContent);

    const uploadRes = await server.inject({
      method: "POST",
      url: `/api/brm/${brmId}/parcours/upload`,
      headers: { cookie, "content-type": contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const uploadBody = uploadRes.json();
    expect(uploadBody.statsParsed).toBe(true);
    expect(uploadBody.parcours.hasFile).toBe(true);
    expect(uploadBody.parcours.distanceKm).toBeGreaterThan(0);
    expect(uploadBody.parcours.fileName).toBe("mon-parcours.gpx");

    const downloadRes = await server.inject({
      method: "GET",
      url: `/api/brm/${brmId}/parcours/file`,
      headers: { cookie },
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.rawPayload.length).toBe(gpxContent.length);

    const deleteRes = await server.inject({
      method: "DELETE",
      url: `/api/brm/${brmId}/parcours/file`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(204);

    const afterDelete = await server.inject({ method: "GET", url: `/api/brm/${brmId}/parcours`, headers: { cookie } });
    expect(afterDelete.json().parcours.hasFile).toBe(false);
  });

  it("rejette un fichier qui n'a pas l'extension .gpx", async () => {
    const cookie = await registerAndLogin(server, `pc-badext-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, cookie);

    const { body, contentType } = buildMultipartBody("file", "parcours.txt", "text/plain", Buffer.from("hello"));
    const res = await server.inject({
      method: "POST",
      url: `/api/brm/${brmId}/parcours/upload`,
      headers: { cookie, "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("isole le téléchargement du fichier entre utilisateurs", async () => {
    const a = await registerAndLogin(server, `pc-dl-a-${Date.now()}@example.com`);
    const b = await registerAndLogin(server, `pc-dl-b-${Date.now()}@example.com`);
    const brmId = await createBrmEvent(server, a);

    const gpxContent = readFileSync(sampleGpxPath);
    const { body, contentType } = buildMultipartBody("file", "secret.gpx", "application/gpx+xml", gpxContent);
    await server.inject({
      method: "POST",
      url: `/api/brm/${brmId}/parcours/upload`,
      headers: { cookie: a, "content-type": contentType },
      payload: body,
    });

    const res = await server.inject({ method: "GET", url: `/api/brm/${brmId}/parcours/file`, headers: { cookie: b } });
    expect(res.statusCode).toBe(404);
  });
});
