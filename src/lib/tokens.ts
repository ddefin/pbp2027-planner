import { createHash, randomBytes } from "node:crypto";

// On ne stocke jamais le jeton brut en base : seulement son hash SHA-256.
// Une fuite de la table sessions/challenges ne permet donc pas de rejouer une session.
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
