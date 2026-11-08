import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { publicName } from "../lib/publicName.js";
import { triggerWebhooks } from "../lib/webhooks.js";

const createSchema = z.object({
  titre: z.string().trim().min(1).max(160),
  date: z.string().datetime(),
  lieu: z.string().trim().min(1).max(160),
});

type SortieWithRelations = {
  id: string;
  titre: string;
  date: Date;
  lieu: string;
  createdBy: { prenom: string };
  participants: { userId: string; user: { prenom: string } }[];
};

function serialize(sortie: SortieWithRelations, currentUserId: string) {
  return {
    id: sortie.id,
    titre: sortie.titre,
    date: sortie.date.toISOString(),
    lieu: sortie.lieu,
    createdBy: publicName(sortie.createdBy),
    participants: sortie.participants.map((p) => publicName(p.user)),
    joined: sortie.participants.some((p) => p.userId === currentUserId),
  };
}

const includeRelations = {
  createdBy: { select: { prenom: true } },
  participants: { include: { user: { select: { prenom: true } } } },
} as const;

export async function sortiesRoutes(app: FastifyInstance) {
  app.get("/sorties", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const sorties = await prisma.sortie.findMany({ orderBy: { date: "asc" }, include: includeRelations });
    return reply.send({ sorties: sorties.map((s) => serialize(s, user.id)) });
  });

  app.post("/sorties", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const sortie = await prisma.sortie.create({
      data: {
        titre: parsed.data.titre,
        date: new Date(parsed.data.date),
        lieu: parsed.data.lieu,
        createdById: user.id,
        participants: { create: { userId: user.id } },
      },
      include: includeRelations,
    });

    // Pas d'await : une notification Discord/Slack lente ne doit jamais retarder la réponse HTTP.
    void triggerWebhooks("sortie.created", {
      titre: sortie.titre,
      date: sortie.date.toISOString(),
      lieu: sortie.lieu,
      createdBy: publicName(user),
    });

    return reply.code(201).send({ sortie: serialize(sortie, user.id) });
  });

  app.post("/sorties/:id/join", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const sortie = await prisma.sortie.findUnique({ where: { id } });
    if (!sortie) return reply.code(404).send({ error: "not_found" });

    await prisma.sortieParticipant.upsert({
      where: { sortieId_userId: { sortieId: id, userId: user.id } },
      create: { sortieId: id, userId: user.id },
      update: {},
    });

    void triggerWebhooks("sortie.participant_joined", { titre: sortie.titre, who: publicName(user) });

    return reply.send({ status: "joined" });
  });

  app.delete("/sorties/:id/join", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    await prisma.sortieParticipant.deleteMany({ where: { sortieId: id, userId: user.id } });
    return reply.code(204).send();
  });

  app.get("/sorties/:id/messages", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const sortie = await prisma.sortie.findUnique({ where: { id } });
    if (!sortie) return reply.code(404).send({ error: "not_found" });

    const messages = await prisma.chatMessage.findMany({
      where: { sortieId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
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
}
