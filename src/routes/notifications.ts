import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";

function serialize(n: { id: string; kind: string; message: string; link: string | null; createdAt: Date; readAt: Date | null }) {
  return {
    id: n.id,
    kind: n.kind,
    message: n.message,
    link: n.link,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
  };
}

export async function notificationsRoutes(app: FastifyInstance) {
  app.get("/notifications", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return reply.send({ notifications: items.map(serialize), unreadCount });
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
}
