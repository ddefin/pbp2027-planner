import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

// AES-256-GCM pour chiffrer au repos les secrets de webhook "generic" (signature
// HMAC) — une fuite de la base seule ne suffit pas à usurper un abonnement webhook.
function getKey(): Buffer {
  const key = Buffer.from(config.mfaEncryptionKeyHex, "hex");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY doit être 32 octets en hex (64 caractères)");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
