import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { actorOf } from "../../lib/adminGuard.js";
import { lastBackupAt, maxBackupAgeDays } from "../../lib/backupWatch.js";
import { redirectUri, stravaConfigured } from "../../lib/strava.js";
import { auditQuery, authEventsQuery } from "../../shared/adminSchemas.js";

export async function adminLogsRoutes(app: FastifyInstance) {
  // Journal d'audit (lecture seule : aucune route ne le modifie).
  app.get("/audit", async (request, reply) => {
    actorOf(request);
    const q = auditQuery.parse(request.query);
    const where = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.q ? { OR: [{ actorEmail: { contains: q.q.toLowerCase() } }, { targetLabel: { contains: q.q } }, { metadata: { contains: q.q } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return reply.send({
      items: rows.map((a) => ({ id: a.id, action: a.action, actorEmail: a.actorEmail, targetType: a.targetType, targetId: a.targetId, targetLabel: a.targetLabel, metadata: a.metadata ? JSON.parse(a.metadata) : null, ip: a.ip, at: a.createdAt.toISOString() })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  // Événements de compte (connexions, mots de passe), y compris pour des adresses SANS compte.
  app.get("/auth-events", async (request, reply) => {
    actorOf(request);
    const q = authEventsQuery.parse(request.query);
    const where = { ...(q.kind ? { kind: q.kind } : {}), ...(q.q ? { email: { contains: q.q.toLowerCase() } } : {}) };
    const [total, rows] = await Promise.all([
      prisma.authEvent.count({ where }),
      prisma.authEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return reply.send({ items: rows.map((e) => ({ id: e.id, email: e.email, kind: e.kind, detail: e.detail, at: e.createdAt.toISOString() })), total, page: q.page, pageSize: q.pageSize });
  });

  // Paramètres : état de la configuration, en lecture seule. Aucun secret n'est renvoyé :
  // les clés restent dans .env.production, jamais modifiables depuis le site.
  app.get("/settings", async (request, reply) => {
    actorOf(request);
    const backup = await lastBackupAt();
    return reply.send({
      version: process.env.APP_VERSION ?? "dev",
      publicUrl: config.publicUrl,
      cookieSecure: config.cookieSecure,
      mail: { configured: Boolean(config.smtp), host: config.smtp?.host ?? null, port: config.smtp?.port ?? null, from: config.smtp?.from ?? null },
      telegram: { bot: Boolean(config.telegramBotToken), botUsername: config.telegramBotUsername, newsChannel: Boolean(config.telegramNewsChatId), trackingChannel: Boolean(process.env.TELEGRAM_TRACKING_CHAT_ID) },
      strava: { configured: stravaConfigured(), redirectUri: redirectUri(), webhook: Boolean(config.stravaWebhookVerifyToken) },
      weather: { configured: Boolean(config.openWeatherApiKey) },
      backup: { lastAt: backup?.toISOString() ?? null, maxAgeDays: maxBackupAgeDays() },
      retention: { authEventsDays: 60, auditLog: "illimitée" },
    });
  });
}
