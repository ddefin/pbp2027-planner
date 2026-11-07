import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { OFFICIAL_LIMIT_MINUTES, VALID_DISTANCES, VALID_STATUSES } from "../lib/brm.js";

const distanceSchema = z.union([z.literal(200), z.literal(300), z.literal(400), z.literal(600)]);
const statusSchema = z.enum(VALID_STATUSES);

const createSchema = z.object({
  distance: distanceSchema,
  date: z.string().datetime(),
  lieu: z.string().trim().min(1).max(120),
  status: statusSchema.optional(),
  limiteMinutes: z.number().int().positive().max(7200).optional(),
  tempsRealiseMinutes: z.number().int().positive().max(7200).nullable().optional(),
});

const updateSchema = z.object({
  distance: distanceSchema.optional(),
  date: z.string().datetime().optional(),
  lieu: z.string().trim().min(1).max(120).optional(),
  status: statusSchema.optional(),
  limiteMinutes: z.number().int().positive().max(7200).optional(),
  tempsRealiseMinutes: z.number().int().positive().max(7200).nullable().optional(),
});

function serialize(event: {
  id: string;
  distance: number;
  date: Date;
  lieu: string;
  status: string;
  limiteMinutes: number;
  tempsRealiseMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: event.id,
    distance: event.distance,
    date: event.date.toISOString(),
    lieu: event.lieu,
    status: event.status,
    limiteMinutes: event.limiteMinutes,
    tempsRealiseMinutes: event.tempsRealiseMinutes,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export async function brmRoutes(app: FastifyInstance) {
  app.get("/brm", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const events = await prisma.brmEvent.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    return reply.send({ events: events.map(serialize) });
  });

  app.post("/brm", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    const { distance, date, lieu, status, limiteMinutes, tempsRealiseMinutes } = parsed.data;

    const event = await prisma.brmEvent.create({
      data: {
        userId: user.id,
        distance,
        date: new Date(date),
        lieu,
        status: status ?? "a-venir",
        limiteMinutes: limiteMinutes ?? OFFICIAL_LIMIT_MINUTES[distance],
        tempsRealiseMinutes: tempsRealiseMinutes ?? null,
      },
    });
    return reply.code(201).send({ event: serialize(event) });
  });

  app.patch("/brm/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.brmEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    const data = parsed.data;

    const event = await prisma.brmEvent.update({
      where: { id },
      data: {
        ...(data.distance !== undefined ? { distance: data.distance } : {}),
        ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
        ...(data.lieu !== undefined ? { lieu: data.lieu } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.limiteMinutes !== undefined ? { limiteMinutes: data.limiteMinutes } : {}),
        ...(data.tempsRealiseMinutes !== undefined ? { tempsRealiseMinutes: data.tempsRealiseMinutes } : {}),
      },
    });
    return reply.send({ event: serialize(event) });
  });

  app.delete("/brm/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.brmEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await prisma.brmEvent.delete({ where: { id } });
    return reply.code(204).send();
  });
}

// Exporté pour les tests, qui veulent vérifier les mêmes contraintes sans dupliquer la liste.
export const brmConstraints = { VALID_DISTANCES, VALID_STATUSES };
