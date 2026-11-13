import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getSessionUser } from "../lib/session.js";

// Page Administration : diagnostic d'un compte (mot de passe oublié, verrouillage, mail).
// Réservée aux administrateurs. Ne renvoie JAMAIS de mot de passe, de hash ni de jeton.
export async function adminRoutes(app: FastifyInstance) {
  async function requireAdmin(request: Parameters<typeof getSessionUser>[0]) {
    const user = await getSessionUser(request);
    return user?.isAdmin ? user : null;
  }

  app.get("/admin/account", async (request, reply) => {
    if (!(await requireAdmin(request))) return reply.code(403).send({ error: "forbidden" });
    const parsed = z.object({ email: z.string().trim().toLowerCase().min(3).max(200) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const email = parsed.data.email;

    const [user, events] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true, prenom: true, email: true, isAdmin: true, createdAt: true, failedLoginAttempts: true, lockedUntil: true } }),
      prisma.authEvent.findMany({ where: { email }, orderBy: { createdAt: "desc" }, take: 40, select: { kind: true, detail: true, createdAt: true } }),
    ]);

    let account = null;
    if (user) {
      const [resetTokens, lastSession] = await Promise.all([
        prisma.passwordResetToken.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, select: { expiresAt: true } }),
        prisma.session.findFirst({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
      ]);
      account = {
        prenom: user.prenom,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt.toISOString(),
        locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
        failedLoginAttempts: user.failedLoginAttempts,
        activeResetLinks: resetTokens.length,
        lastSeenAt: lastSession?.lastSeenAt.toISOString() ?? null,
      };
    }

    return reply.send({
      exists: Boolean(user),
      account,
      events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.createdAt.toISOString() })),
      mail: {
        configured: Boolean(config.smtp),
        host: config.smtp?.host ?? null,
        port: config.smtp?.port ?? null,
        from: config.smtp?.from ?? null,
        publicUrl: config.publicUrl,
      },
    });
  });
}
