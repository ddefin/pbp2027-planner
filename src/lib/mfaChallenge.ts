import { prisma } from "../db.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Jeton remis après "mot de passe correct" mais avant "code MFA correct".
// Il ne donne accès à rien d'autre qu'à la vérification du code.
export async function createMfaChallenge(userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.mfaChallenge.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return token;
}

export type ChallengeOutcome =
  | { status: "ok"; userId: string }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "too_many_attempts" };

export async function consumeMfaChallenge(token: string): Promise<ChallengeOutcome> {
  const challenge = await prisma.mfaChallenge.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!challenge) return { status: "invalid" };
  if (challenge.expiresAt < new Date()) {
    await prisma.mfaChallenge.delete({ where: { id: challenge.id } });
    return { status: "expired" };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await prisma.mfaChallenge.delete({ where: { id: challenge.id } });
    return { status: "too_many_attempts" };
  }
  return { status: "ok", userId: challenge.userId };
}

export async function recordFailedAttempt(token: string): Promise<void> {
  await prisma.mfaChallenge
    .update({ where: { tokenHash: hashToken(token) }, data: { attempts: { increment: 1 } } })
    .catch(() => undefined); // déjà expiré/supprimé entre-temps : rien à faire
}

export async function deleteChallenge(token: string): Promise<void> {
  await prisma.mfaChallenge.deleteMany({ where: { tokenHash: hashToken(token) } });
}
