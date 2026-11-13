import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { AdminError, actorOf, confirmPassword, limitDeletions, type AdminUser } from "../../lib/adminGuard.js";
import { auditEntry } from "../../lib/audit.js";
import { anonymizeAndDeleteOps, ensureSystemUser, personalFiles, removeFiles, revokeExternalAccess } from "../../lib/accountDeletion.js";
import { destroyAllSessions } from "../../lib/session.js";
import { idParam, reasonSchema, bulkSchema, roleSchema, deleteSchema, userListQuery } from "../../shared/adminSchemas.js";
import type { Prisma } from "@prisma/client";
import { ONLINE_MS, RECENT_MS, presenceOf } from "../../shared/presence.js";
import { issuePasswordReset } from "../../lib/passwordReset.js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { logAuthEvent } from "../../lib/authEvents.js";

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

function statusOf(u: { suspendedAt: Date | null; lockedUntil: Date | null }, now = new Date()): "active" | "suspended" | "locked" {
  if (u.suspendedAt) return "suspended";
  if (u.lockedUntil && u.lockedUntil > now) return "locked";
  return "active";
}

// Navigateur lisible à partir du user-agent (sans détail identifiant).
function device(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Autre";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  return `${br} · ${os}`;
}

export async function adminUsersRoutes(app: FastifyInstance) {
  // Liste paginée côté serveur : recherche, filtres, tri sur une liste fermée de colonnes.
  app.get("/users", async (request, reply) => {
    actorOf(request);
    const q = userListQuery.parse(request.query);
    const now = new Date();
    const where: Prisma.UserWhereInput = { isSystem: false };
    const and: Prisma.UserWhereInput[] = [];
    if (q.q) and.push({ OR: [{ prenom: { contains: q.q } }, { email: { contains: q.q.toLowerCase() } }, { club: { contains: q.q } }] });
    if (q.status === "suspended") and.push({ suspendedAt: { not: null } });
    if (q.status === "locked") and.push({ suspendedAt: null, lockedUntil: { gt: now } });
    if (q.status === "active") and.push({ suspendedAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] });
    if (q.role === "admin") and.push({ isAdmin: true });
    if (q.role === "member") and.push({ isAdmin: false });
    if (q.presence !== "all") {
      // Présence = dernière activité de ses sessions (quelques centaines de comptes au plus).
      const seen = await prisma.session.groupBy({ by: ["userId"], _max: { lastSeenAt: true } });
      const online = seen.filter((x) => x._max.lastSeenAt && now.getTime() - x._max.lastSeenAt.getTime() < ONLINE_MS).map((x) => x.userId);
      const within72 = seen.filter((x) => x._max.lastSeenAt && now.getTime() - x._max.lastSeenAt.getTime() < RECENT_MS).map((x) => x.userId);
      if (q.presence === "online") and.push({ id: { in: online } });
      else if (q.presence === "recent") and.push({ id: { in: within72.filter((id) => !online.includes(id)) } });
      else and.push({ id: { notIn: within72 } });
    }
    if (and.length) where.AND = and;

    const select = { id: true, prenom: true, email: true, club: true, isAdmin: true, createdAt: true, suspendedAt: true, suspendedReason: true, lockedUntil: true } as const;
    const total = await prisma.user.count({ where });
    let rows: Prisma.UserGetPayload<{ select: typeof select }>[];
    let lastSeen = new Map<string, Date>();
    if (q.sort === "lastSeenAt") {
      // Dernière activité = la plus récente de ses sessions : tri en mémoire (quelques centaines de comptes au plus).
      const all = await prisma.user.findMany({ where, select });
      const agg = await prisma.session.groupBy({ by: ["userId"], where: { userId: { in: all.map((u) => u.id) } }, _max: { lastSeenAt: true } });
      lastSeen = new Map(agg.filter((a) => a._max.lastSeenAt).map((a) => [a.userId, a._max.lastSeenAt!]));
      const t = (id: string) => lastSeen.get(id)?.getTime() ?? 0;
      all.sort((a, b) => (q.dir === "asc" ? t(a.id) - t(b.id) : t(b.id) - t(a.id)));
      rows = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    } else {
      rows = await prisma.user.findMany({ where, select, orderBy: [{ [q.sort]: q.dir }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize });
      const agg = await prisma.session.groupBy({ by: ["userId"], where: { userId: { in: rows.map((u) => u.id) } }, _max: { lastSeenAt: true } });
      lastSeen = new Map(agg.filter((a) => a._max.lastSeenAt).map((a) => [a.userId, a._max.lastSeenAt!]));
    }
    return reply.send({
      items: rows.map((u) => ({
        id: u.id,
        prenom: u.prenom,
        email: u.email,
        club: u.club,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt.toISOString(),
        lastSeenAt: lastSeen.get(u.id)?.toISOString() ?? null,
        presence: presenceOf(lastSeen.get(u.id), now),
        status: statusOf(u, now),
        suspendedReason: u.suspendedReason,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  // Fiche d'un compte : état, données, appareils, événements de compte, historique admin.
  app.get("/users/:id", async (request, reply) => {
    actorOf(request);
    const { id } = idParam.parse(request.params);
    const u = await target(id);
    const [sessions, resetLinks, events, audit, roadbooks, messages, brm, strava, telegram, pbpRoutes] = await Promise.all([
      prisma.session.findMany({ where: { userId: id }, orderBy: { lastSeenAt: "desc" }, take: 5, select: { lastSeenAt: true, createdAt: true, userAgent: true } }),
      prisma.passwordResetToken.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
      prisma.authEvent.findMany({ where: { email: u.email }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.adminAuditLog.findMany({ where: { targetType: "user", targetId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.roadbook.count({ where: { userId: id } }),
      prisma.groupMessage.count({ where: { userId: id } }),
      prisma.brmEvent.count({ where: { userId: id } }),
      prisma.stravaAccount.findUnique({ where: { userId: id }, select: { lastSyncAt: true } }),
      prisma.telegramLink.findUnique({ where: { userId: id }, select: { linkedAt: true } }),
      prisma.pbpRoute.count({ where: { uploadedByUserId: id } }),
    ]);
    return reply.send({
      user: {
        id: u.id,
        prenom: u.prenom,
        email: u.email,
        club: u.club,
        licenceNumero: u.licenceNumero,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt.toISOString(),
        status: statusOf(u),
        suspendedAt: u.suspendedAt?.toISOString() ?? null,
        suspendedReason: u.suspendedReason,
        lockedUntil: u.lockedUntil?.toISOString() ?? null,
        failedLoginAttempts: u.failedLoginAttempts,
        activeResetLinks: resetLinks,
        lastSeenAt: sessions[0]?.lastSeenAt.toISOString() ?? null,
        presence: presenceOf(sessions[0]?.lastSeenAt),
      },
      data: { roadbooks, messages, brm, pbpRoutes, strava: Boolean(strava), telegram: Boolean(telegram) },
      sessions: sessions.map((s) => ({ device: device(s.userAgent), lastSeenAt: s.lastSeenAt.toISOString(), createdAt: s.createdAt.toISOString() })),
      events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.createdAt.toISOString() })),
      audit: audit.map((a) => ({ id: a.id, action: a.action, actorEmail: a.actorEmail, metadata: a.metadata ? JSON.parse(a.metadata) : null, at: a.createdAt.toISOString() })),
    });
  });

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

  // Envoi d'un lien de réinitialisation par l'administrateur (membre qui n'y arrive pas
  // seul). Le lien part UNIQUEMENT dans la boîte du membre : il n'est jamais renvoyé ici.
  app.post("/users/:id/send-reset", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const u = await target(id);
    if (u.suspendedAt) throw new AdminError(409, "account_suspended");
    if (!config.smtp) throw new AdminError(503, "mail_not_configured");
    if (!checkRateLimit(`admin-reset:${u.id}`, 3, 3_600_000).allowed) throw new AdminError(429, "too_many_requests");
    const base = config.publicUrl || `${request.protocol}://${request.headers.host}`;
    const result = await issuePasswordReset(u, base);
    await logAuthEvent(u.email, result.ok ? "mail_sent" : "mail_failed", result.ok ? "envoyé par un administrateur" : result.error);
    await auditEntry(request, actor, { action: "user.reset_link", targetType: "user", targetId: id, targetLabel: label(u), metadata: { sent: result.ok, error: result.error } });
    return reply.send({ sent: result.ok, error: result.error });
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
