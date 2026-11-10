import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

const prenomSchema = z.string().trim().min(1).max(60);
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const updateProfileSchema = z.object({
  prenom: prenomSchema.optional(),
  licenceNumero: optionalTextSchema(40),
  club: optionalTextSchema(120),
  notebook: optionalTextSchema(20000),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(256),
});

const eventSchema = z.object({
  title: z.string().trim().min(1).max(150),
  date: z.string().datetime().or(z.string().min(1)), // accepte "YYYY-MM-DD" ou ISO complet
  notes: z.string().trim().max(2000).optional().nullable(),
});

function serializeEvent(e: { id: string; title: string; date: Date; notes: string | null }) {
  return { id: e.id, title: e.title, date: e.date.toISOString(), notes: e.notes };
}

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    return reply.send({
      email: user.email,
      prenom: user.prenom,
      licenceNumero: user.licenceNumero,
      club: user.club,
      notebook: user.notebook,
    });
  });

  app.patch("/profile", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data,
    });

    return reply.send({
      email: updated.email,
      prenom: updated.prenom,
      licenceNumero: updated.licenceNumero,
      club: updated.club,
      notebook: updated.notebook,
    });
  });

  app.post("/profile/change-password", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return reply.code(401).send({ error: "invalid_current_password" });

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    return reply.send({ status: "password_changed" });
  });

  // Événements personnels : entièrement privés, jamais filtrés/partagés au
  // groupe (contrairement aux Sorties ou au calendrier BRM) — un randonneur ne
  // voit et ne modifie jamais que les siens.
  app.get("/profile/events", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const events = await prisma.personalEvent.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    return reply.send({ events: events.map(serializeEvent) });
  });

  app.post("/profile/events", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const date = new Date(parsed.data.date);
    if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: "invalid_date" });

    const event = await prisma.personalEvent.create({
      data: { userId: user.id, title: parsed.data.title, date, notes: parsed.data.notes || null },
    });
    return reply.code(201).send({ event: serializeEvent(event) });
  });

  app.patch("/profile/events/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.personalEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const parsed = eventSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    let date: Date | undefined;
    if (parsed.data.date !== undefined) {
      date = new Date(parsed.data.date);
      if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: "invalid_date" });
    }

    const event = await prisma.personalEvent.update({
      where: { id },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(date ? { date } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    });
    return reply.send({ event: serializeEvent(event) });
  });

  app.delete("/profile/events/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.personalEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await prisma.personalEvent.delete({ where: { id } });
    return reply.code(204).send();
  });
}
