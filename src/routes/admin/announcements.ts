import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { AdminError, actorOf } from "../../lib/adminGuard.js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { escapeHtml, sendTelegramMessage } from "../../lib/telegram.js";
import { announcementSchema } from "../../shared/adminSchemas.js";

// Destinataires d'une annonce : membres actifs (ni suspendus, ni compte système).
const ACTIVE = { isSystem: false, suspendedAt: null } as const;

export async function adminAnnouncementsRoutes(app: FastifyInstance) {
  app.get("/announcements/recipients", async (request, reply) => {
    actorOf(request);
    const [members, telegram] = await Promise.all([prisma.user.count({ where: ACTIVE }), prisma.telegramLink.count({ where: { user: ACTIVE } })]);
    return reply.send({ members, telegram });
  });

  // Historique : les annonces envoyées, lues dans le journal d'audit.
  app.get("/announcements", async (request, reply) => {
    actorOf(request);
    const rows = await prisma.adminAuditLog.findMany({ where: { action: "announcement.send" }, orderBy: { createdAt: "desc" }, take: 30 });
    return reply.send({
      items: rows.map((a) => {
        const m = a.metadata ? (JSON.parse(a.metadata) as { message?: string; recipients?: number; telegramSent?: number }) : {};
        return { id: a.id, actorEmail: a.actorEmail, message: m.message ?? "", recipients: m.recipients ?? 0, telegramSent: m.telegramSent ?? 0, at: a.createdAt.toISOString() };
      }),
    });
  });

  app.post("/announcements", async (request, reply) => {
    const actor = actorOf(request);
    const { message, telegram } = announcementSchema.parse(request.body);
    if (!checkRateLimit(`admin-announce:${actor.id}`, 5, 3_600_000).allowed) throw new AdminError(429, "too_many_requests");

    const users = await prisma.user.findMany({ where: ACTIVE, select: { id: true, telegramLink: { select: { chatId: true } } } });
    const text = `📣 Annonce : ${message}`;
    // Cloche de chaque membre + trace d'audit dans la même transaction.
    const audit = await prisma.$transaction(async (tx) => {
      await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, kind: "announcement", message: text, link: null })) });
      return tx.adminAuditLog.create({
        data: { actorId: actor.id, actorEmail: actor.email, action: "announcement.send", targetType: "announcement", targetId: "groupe", targetLabel: `Annonce à ${users.length} membre${users.length > 1 ? "s" : ""}`, metadata: JSON.stringify({ message, recipients: users.length, telegram }), ip: request.ip ?? null, userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300) || null },
      });
    });

    // Telegram ensuite (jamais bloquant) : message privé aux membres qui ont lié leur compte.
    let telegramSent = 0;
    if (telegram) {
      for (const u of users) {
        if (!u.telegramLink) continue;
        if (await sendTelegramMessage(u.telegramLink.chatId, `📣 <b>Annonce</b>\n${escapeHtml(message)}`).catch(() => false)) telegramSent++;
      }
      // Complète l'entrée que cette même requête vient d'écrire (nombre réellement remis).
      await prisma.adminAuditLog.update({ where: { id: audit.id }, data: { metadata: JSON.stringify({ message, recipients: users.length, telegram, telegramSent }) } });
    }
    return reply.send({ ok: true, recipients: users.length, telegramSent });
  });
}
