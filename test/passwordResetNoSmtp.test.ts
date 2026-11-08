// Dans un fichier séparé exprès : src/config.ts lit SMTP_HOST une seule fois à
// l'import, donc ce scénario "pas de SMTP configuré" a besoin d'un graphe de
// modules vierge (vitest isole chaque fichier de test dans son propre contexte).
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, "prisma/test-password-reset-no-smtp.db");

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
  process.env.MFA_ENCRYPTION_KEY = "99".repeat(32);
  process.env.COOKIE_SECURE = "false";
  delete process.env.SMTP_HOST;
  execSync("npx prisma migrate deploy", { cwd: repoRoot, stdio: "pipe" });

  ({ buildServer } = await import("../src/server.js"));
  ({ prisma } = await import("../src/db.js"));
});

afterAll(async () => {
  await prisma?.$disconnect();
  cleanupDbFiles();
});

describe("Mot de passe oublié sans SMTP configuré", () => {
  it("renvoie 503 plutôt que de planter", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "quelqu-un@example.com" } });
    expect(res.statusCode).toBe(503);
  });
});
