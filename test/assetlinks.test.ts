import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Appli Android (TWA) : Android vérifie /.well-known/assetlinks.json avant d'ouvrir le
// site sans barre d'adresse. Ce fichier doit sortir en JSON, pas en index.html.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../web/public");

let distDir: string;
let buildServer: typeof import("../src/server.js").buildServer;

beforeAll(async () => {
  distDir = mkdtempSync(path.join(os.tmpdir(), "pbp-dist-"));
  writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>app</title>");
  cpSync(path.join(publicDir, ".well-known"), path.join(distDir, ".well-known"), { recursive: true });
  process.env.WEB_DIST_PATH = distDir;
  process.env.DATABASE_URL ??= "file:./unused-assetlinks.db";
  process.env.MFA_ENCRYPTION_KEY ??= "44".repeat(32);
  ({ buildServer } = await import("../src/server.js"));
});

afterAll(() => {
  delete process.env.WEB_DIST_PATH;
  rmSync(distDir, { recursive: true, force: true });
});

describe("Digital Asset Links (appli Android)", () => {
  it("sert assetlinks.json en JSON, pas la page de l'app", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    await server.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    const body = res.json();
    expect(body).toEqual(JSON.parse(readFileSync(path.join(publicDir, ".well-known/assetlinks.json"), "utf8")));
    expect(body[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(body[0].target.package_name).toBe("fr.lameteoducyclo.pbp2027");
    for (const fp of body[0].target.sha256_cert_fingerprints) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
