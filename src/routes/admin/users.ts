import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { AdminError, actorOf, confirmPassword, limitDeletions, type AdminUser } from "../../lib/adminGuard.js";
import { auditEntry } from "../../lib/audit.js";
import { anonymizeAndDeleteOps, ensureSystemUser, personalFiles, removeFiles, revokeExternalAccess } from "../../lib/accountDeletion.js";
import { destroyAllSessions } from "../../lib/session.js";
import { idParam, reasonSchema, bulkSchema, roleSchema, deleteSchema } from "../../shared/adminSchemas.js";

const label = (u: { prenom: string; email: string }) => `${u.prenom} (${u.email})`;

// Cible d'une action : jamais le compte système, jamais inexistante.
async function target(id: string) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.isSystem) throw new AdminError(404, "not_found");
  return u;
}

// Il doit toujours rester au moins un administrateur actif (non suspendu).
async function assertAnotherActiveAdmin(excludingId: string) {
  const n = await prisma.user.count({ where: { isAdmin: true, suspendedAt: null, isSystem: false, id: { not: excludingId } } });
  if (n === 0) throw new AdminError(409, "last_admin");
}

async function suspendOne(request: FastifyRequest, actor: AdminUser, id: string, reason: string) {
  if (id === actor.id) throw new AdminError(409, "cannot_target_self");
  const u = await target(id);
  if (u.suspendedAt) return false;
  if (u.isAdmin) await assertAnotherActiveAdmin(u.id);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { suspendedAt: new Date(), suspendedReason: reason } }),
    prisma.session.deleteMany({ where: { userId: id } }),
    auditEntry(request, actor, { action: "user.suspend", targetType: "user", targetId: id, targetLabel: label(u), metadata: { reason } }),
  ]);
  return true;
}

async function unsuspendOne(request: FastifyRequest, actor: AdminUser, id: string) {
  const u = await target(id);
  if (!u.suspendedAt) return false;
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { suspendedAt: null, suspendedReason: null, failedLoginAttempts: 0, lockedUntil: null } }),
    auditEntry(request, actor, { action: "user.unsuspend", targetType: "user", targetId: id, targetLabel: label(u), metadata: { previousReason: u.suspendedReason } }),
  ]);
  return true;
}

export async function adminUsersRoutes(app: FastifyInstance) {
  app.post("/users/:id/suspend", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { reason } = reasonSchema.parse(request.body);
    await suspendOne(request, actor, id, reason);
    return reply.send({ ok: true });
  });

  app.post("/users/:id/unsuspend", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    await unsuspendOne(request, actor, id);
    return reply.send({ ok: true });
  });

  // Actions groupées : suspendre / réactiver. La suppression reste unitaire (double confirmation).
  app.post("/users/bulk", async (request, reply) => {
    const actor = actorOf(request);
    const body = bulkSchema.parse(request.body);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of body.ids) {
      try {
        const changed = body.action === "suspend" ? await suspendOne(request, actor, id, body.reason ?? "Suspension groupée") : await unsuspendOne(request, actor, id);
        results.push({ id, ok: changed });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof AdminError ? err.code : "internal_error" });
      }
    }
    return reply.send({ results });
  });

  // Rôle : mot de passe de l'administrateur redemandé.
  app.post("/users/:id/role", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { isAdmin, password } = roleSchema.parse(request.body);
    await confirmPassword(actor, password);
    const u = await target(id);
    if (u.isAdmin === isAdmin) return reply.send({ ok: true });
    if (!isAdmin) await assertAnotherActiveAdmin(u.id);
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { isAdmin } }),
      auditEntry(request, actor, { action: isAdmin ? "user.promote" : "user.demote", targetType: "user", targetId: id, targetLabel: label(u), metadata: { from: u.isAdmin ? "admin" : "membre", to: isAdmin ? "admin" : "membre" } }),
    ]);
    // Un rôle retiré prend effet tout de suite : on coupe ses sessions.
    if (!isAdmin) await destroyAllSessions(id);
    return reply.send({ ok: true });
  });

  // Suppression définitive (anonymisation des contributions de groupe) : adresse du compte
  // ET mot de passe de l'administrateur.
  app.post("/users/:id/delete", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { confirmEmail, password } = deleteSchema.parse(request.body);
    if (id === actor.id) throw new AdminError(409, "cannot_target_self");
    const u = await target(id);
    if (confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) throw new AdminError(400, "confirmation_mismatch");
    await confirmPassword(actor, password);
    limitDeletions(actor);
    if (u.isAdmin) await assertAnotherActiveAdmin(u.id);

    const files = await personalFiles(id);
    const counts = {
      messages: await prisma.groupMessage.count({ where: { userId: id } }),
      roadbooks: await prisma.roadbook.count({ where: { userId: id } }),
      pbpRoutes: await prisma.pbpRoute.count({ where: { uploadedByUserId: id } }),
    };
    await revokeExternalAccess(id);
    const systemId = await ensureSystemUser();
    await prisma.$transaction([
      auditEntry(request, actor, { action: "user.delete", targetType: "user", targetId: id, targetLabel: label(u), metadata: { anonymized: counts } }),
      ...anonymizeAndDeleteOps(id, systemId),
    ]);
    await removeFiles(files);
    return reply.send({ ok: true });
  });

  // Diagnostic d'un compte par adresse (mot de passe oublié, verrouillage, envoi du mail).
  app.get("/account", async (request, reply) => {
    actorOf(request);
    const parsed = z.object({ email: z.string().trim().toLowerCase().min(3).max(200) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const email = parsed.data.email;
    const [user, events] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true, prenom: true, email: true, isAdmin: true, isSystem: true, createdAt: true, failedLoginAttempts: true, lockedUntil: true, suspendedAt: true } }),
      prisma.authEvent.findMany({ where: { email }, orderBy: { createdAt: "desc" }, take: 40, select: { kind: true, detail: true, createdAt: true } }),
    ]);
    let account = null;
    if (user && !user.isSystem) {
      const [resetTokens, lastSession] = await Promise.all([
        prisma.passwordResetToken.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, select: { expiresAt: true } }),
        prisma.session.findFirst({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
      ]);
      account = {
        id: user.id,
        prenom: user.prenom,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt.toISOString(),
        locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
        suspended: Boolean(user.suspendedAt),
        failedLoginAttempts: user.failedLoginAttempts,
        activeResetLinks: resetTokens.length,
        lastSeenAt: lastSession?.lastSeenAt.toISOString() ?? null,
      };
    }
    return reply.send({
      exists: Boolean(account),
      account,
      events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.createdAt.toISOString() })),
      mail: { configured: Boolean(config.smtp), host: config.smtp?.host ?? null, port: config.smtp?.port ?? null, from: config.smtp?.from ?? null, publicUrl: config.publicUrl },
    });
  });
}
