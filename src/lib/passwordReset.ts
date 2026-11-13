import { prisma } from "../db.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";
import { sendPasswordResetEmail, type MailResult } from "./mailer.js";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

// Crée un jeton de réinitialisation (stocké haché) et renvoie le lien à envoyer. Le lien ne
// doit partir QUE par e-mail : ne jamais le renvoyer dans une réponse HTTP ni le journaliser.
export async function createResetUrl(user: { id: string }, baseUrl: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  return `${baseUrl.replace(/\/$/, "")}/reinitialiser-mot-de-passe?token=${token}`;
}

// Jeton + envoi, en attendant le résultat (console d'administration).
export async function issuePasswordReset(user: { id: string; email: string }, baseUrl: string): Promise<MailResult> {
  return sendPasswordResetEmail(user.email, await createResetUrl(user, baseUrl));
}
