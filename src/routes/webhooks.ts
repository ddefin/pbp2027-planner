import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { VALID_EVENTS, VALID_FORMATS, encryptSecret, generateWebhookSecret, sendTestEvent } from "../lib/webhooks.js";

const createSchema = z.object({
  url: z.string().url().startsWith("https://", "L'URL du webhook doit être en https://"),
  format: z.enum(VALID_FORMATS),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.enum(VALID_EVENTS)).min(1).optional(),
});

function serialize(sub: {
  id: string;
  url: string;
  format: string;
  events: string;
  enabled: boolean;
  createdAt: Date;
  lastTriggeredAt: Date | null;
  lastStatus: string | null;
}) {
  return {
    id: sub.id,
    url: sub.url,
    format: sub.format,
    events: sub.events.split(","),
    enabled: sub.enabled,
    createdAt: sub.createdAt.toISOString(),
    lastTriggeredAt: sub.lastTriggeredAt?.toISOString() ?? null,
    lastStatus: sub.lastStatus,
  };
}

export async function webhooksRoutes(app: FastifyInstance) {
  app.get("/webhooks", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const subs = await prisma.webhookSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ webhooks: subs.map(serialize) });
  });

  app.post("/webhooks", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { url, format, events } = parsed.data;

    const secret = format === "generic" ? generateWebhookSecret() : null;
    const sub = await prisma.webhookSubscription.create({
      data: {
        userId: user.id,
        url,
        format,
        events: events.join(","),
        secretEncrypted: secret ? encryptSecret(secret) : null,
      },
    });

    // Le secret en clair n'est renvoyé qu'ici, jamais réaffiché ni renvoyé par GET /webhooks.
    return reply.code(201).send({ webhook: serialize(sub), secret });
  });

  app.patch("/webhooks/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const sub = await prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.events !== undefined ? { events: parsed.data.events.join(",") } : {}),
      },
    });
    return reply.send({ webhook: serialize(sub) });
  });

  app.delete("/webhooks/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await prisma.webhookSubscription.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/webhooks/:id/test", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    if (!existing.enabled) return reply.code(400).send({ error: "disabled" });

    await sendTestEvent(existing);

    const updated = await prisma.webhookSubscription.findUnique({ where: { id } });
    return reply.send({ lastStatus: updated?.lastStatus ?? null });
  });
}
