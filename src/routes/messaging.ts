import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { publicName } from "../lib/publicName.js";

const MESSAGE_PAGE_SIZE = 200;

export async function messagingRoutes(app: FastifyInstance) {
  // Liste des randonneurs avec qui démarrer une conversation privée — jamais l'email,
  // seulement id + prénom (voir src/lib/publicName.ts).
  app.get("/messaging/users", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const users = await prisma.user.findMany({
      where: { id: { not: user.id } },
      select: { id: true, prenom: true },
      orderBy: { prenom: "asc" },
    });
    return reply.send({ users });
  });

  app.get("/messaging/general/messages", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const messages = await prisma.groupMessage.findMany({
      orderBy: { createdAt: "asc" },
      take: MESSAGE_PAGE_SIZE,
      include: { user: { select: { prenom: true } } },
    });
    return reply.send({
      messages: messages.map((m) => ({
        id: m.id,
        who: publicName(m.user),
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  // Une ligne par interlocuteur avec qui une conversation existe (dans un sens ou
  // l'autre), triée par dernier message, avec un compteur de non-lus.
  app.get("/messaging/dm/conversations", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const messages = await prisma.directMessage.findMany({
      where: { OR: [{ senderId: user.id }, { recipientId: user.id }] },
      orderBy: { createdAt: "desc" },
      include: { sender: { select: { id: true, prenom: true } }, recipient: { select: { id: true, prenom: true } } },
    });

    const byPeer = new Map<
      string,
      { peerId: string; prenom: string; lastText: string; lastAt: string; unread: number }
    >();
    for (const m of messages) {
      const peer = m.senderId === user.id ? m.recipient : m.sender;
      const existing = byPeer.get(peer.id);
      if (!existing) {
        byPeer.set(peer.id, {
          peerId: peer.id,
          prenom: peer.prenom,
          lastText: m.text,
          lastAt: m.createdAt.toISOString(),
          unread: m.recipientId === user.id && m.readAt === null ? 1 : 0,
        });
      } else if (m.recipientId === user.id && m.readAt === null) {
        existing.unread += 1;
      }
    }

    return reply.send({ conversations: Array.from(byPeer.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt)) });
  });

  app.get("/messaging/dm/:peerId/messages", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId } = request.params as { peerId: string };
    const peer = await prisma.user.findUnique({ where: { id: peerId }, select: { id: true } });
    if (!peer) return reply.code(404).send({ error: "not_found" });

    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: user.id, recipientId: peerId },
          { senderId: peerId, recipientId: user.id },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: MESSAGE_PAGE_SIZE,
    });

    // Marque comme lus les messages reçus de ce correspondant précis, maintenant
    // qu'on vient d'en afficher l'historique.
    await prisma.directMessage.updateMany({
      where: { senderId: peerId, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });

    return reply.send({
      messages: messages.map((m) => ({
        id: m.id,
        fromUserId: m.senderId,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });
}
