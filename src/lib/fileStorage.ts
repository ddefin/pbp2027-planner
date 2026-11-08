import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Même volume que la base SQLite (./data, voir docker-compose.yml) : les fichiers
// survivent aux mises à jour d'image et sont couverts par la même sauvegarde
// (scripts/backup.sh), sans avoir besoin d'un volume supplémentaire.
const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "data", "uploads");

// Stocke le contenu sur disque et renvoie un chemin RELATIF à UPLOADS_ROOT (jamais
// de chemin absolu en base : UPLOADS_ROOT peut changer entre environnements).
export async function saveUploadedFile(subdir: string, buffer: Buffer): Promise<string> {
  const dir = path.join(UPLOADS_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomBytes(8).toString("hex")}`;
  await writeFile(path.join(dir, name), buffer);
  return path.join(subdir, name);
}

export async function readUploadedFile(relativePath: string): Promise<Buffer> {
  return readFile(path.join(UPLOADS_ROOT, relativePath));
}

export async function deleteUploadedFile(relativePath: string): Promise<void> {
  await unlink(path.join(UPLOADS_ROOT, relativePath)).catch(() => undefined);
}
