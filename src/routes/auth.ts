import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { hashToken } from "../lib/tokens.js";
import { createSession, destroySession, destroyAllSessions, getSessionUser } from "../lib/session.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { generateOpaqueToken } from "../lib/tokens.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { logAuthEvent } from "../lib/authEvents.js";

const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const emailSchema = z.string().email().max(254).toLowerCase();
const passwordSchema = z.string().min(10).max(256);
const prenomSchema = z.string().trim().min(1).max(60);

const registerSchema = z.object({ email: emailSchema, password: passwordSchema, prenom: prenomSchema });
const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
const forgotPasswordSchema = z.object({ email: emailSchema });
const resetPasswordSchema = z.object({ token: z.string().min(1), password: passwordSchema });

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { email, password, prenom } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Même réponse générique que pour un succès, pour ne pas révéler les comptes existants.
      return reply.code(202).send({ status: "check_email_if_new" });
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.create({ data: { email, prenom, passwordHash } });
    return reply.code(202).send({ status: "check_email_if_new" });
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    if (!config.smtp) return reply.code(503).send({ error: "not_configured" });

    const limited = checkRateLimit(`forgot-password:${request.ip}`, 5, 15 * 60 * 1000);
    if (!limited.allowed) return reply.code(429).send({ error: "too_many_requests" });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    // Même réponse qu'il existe un compte ou non, pour ne pas révéler les comptes
    // existants — l'email n'est envoyé que si le compte existe vraiment.
    if (user) {
      const token = generateOpaqueToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      await logAuthEvent(user.email, "reset_requested");

      const base = config.publicUrl || `${request.protocol}://${request.headers.host}`;
      const resetUrl = `${base}/reinitialiser-mot-de-passe?token=${token}`;
      // L'envoi tourne en arrière-plan ; son résultat (et sa cause en cas d'échec) est gardé
      // dans le journal pour la page Administration.
      void sendPasswordResetEmail(user.email, resetUrl).then((r) =>
        logAuthEvent(user.email, r.ok ? "mail_sent" : "mail_failed", r.error),
      );
    } else {
      await logAuthEvent(parsed.data.email, "reset_no_account");
    }

    return reply.code(202).send({ status: "check_email_if_account_exists" });
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const limited = checkRateLimit(`reset-password:${request.ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return reply.code(429).send({ error: "too_many_requests" });

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!resetToken || resetToken.expiresAt < new Date()) {
      const u = resetToken ? await prisma.user.findUnique({ where: { id: resetToken.userId }, select: { email: true } }) : null;
      await logAuthEvent(u?.email ?? "inconnu", "reset_token_invalid", resetToken ? "expiré" : "introuvable");
      return reply.code(401).send({ error: "invalid_or_expired_token" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      // À usage unique : tous les jetons de cet utilisateur sont invalidés, pas
      // seulement celui utilisé (évite qu'un lien par email resté ouvert ailleurs
      // reste valable).
      prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } }),
    ]);
    // Si le compte a été compromis, un mot de passe réinitialisé doit aussi
    // déconnecter toute session déjà ouverte ailleurs.
    await destroyAllSessions(resetToken.userId);
    const done = await prisma.user.findUnique({ where: { id: resetToken.userId }, select: { email: true } });
    await logAuthEvent(done?.email ?? "inconnu", "reset_ok");

    return reply.send({ status: "password_reset" });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { email, password } = parsed.data;

    const ip = request.ip;
    const limited = checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
    if (!limited.allowed) return reply.code(429).send({ error: "too_many_requests" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await verifyPassword(password, "scrypt$16384$8$1$00$00"); // coût constant même si l'email n'existe pas
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logAuthEvent(user.email, "login_locked", `jusqu'à ${user.lockedUntil.toISOString()}`);
      return reply.code(423).send({ error: "account_locked", retryAt: user.lockedUntil });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= LOCKOUT_THRESHOLD;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: locked ? 0 : attempts,
          lockedUntil: locked ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    if (user.failedLoginAttempts > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    await createSession(user.id, reply, { userAgent: request.headers["user-agent"], ip });
    return reply.send({ status: "authenticated" });
  });

  app.get("/auth/session", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send({ email: user.email, prenom: user.prenom, isAdmin: user.isAdmin });
  });

  app.post("/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return reply.send({ status: "logged_out" });
  });
}
