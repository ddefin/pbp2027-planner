import { createHash, randomBytes } from "node:crypto";

// On ne stocke jamais le jeton brut en base : seulement son hash SHA-256.
// Une fuite de la table sessions/challenges ne permet donc pas de rejouer une session.
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRecoveryCode(): string {
  // Format "xxxx-xxxx" lisible, en base32 sans caractères ambigus (0/O, 1/I déjà absents).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
