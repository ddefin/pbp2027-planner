import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

export const SESSION_COOKIE = "pbp_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours, glissant

export async function createSession(
  userId: string,
  reply: FastifyReply,
  meta: { userAgent?: string; ip?: string },
) {
  const token = generateOpaqueToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent,
      ip: meta.ip,
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSessionUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;

  // Renouvellement glissant : repousse l'expiration tant que la session est active,
  // sans jamais dépasser l'intention de durée fixée à la création.
  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return session.user;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function destroyOtherSessions(userId: string, request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  const keepHash = token ? hashToken(token) : undefined;
  await prisma.session.deleteMany({
    where: { userId, ...(keepHash ? { tokenHash: { not: keepHash } } : {}) },
  });
}
