import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { fetchFranceBrmCatalog } from "../lib/acpCatalog.js";
import { CATALOG_STATUSES, VALID_DISTANCES } from "../lib/brm.js";
import { publicName } from "../lib/publicName.js";
import { triggerWebhooks } from "../lib/webhooks.js";
import { fetchCityWeather } from "../lib/openWeather.js";
import { config } from "../config.js";

// Fenêtre de qualification PBP 2027 demandée : saison précédant le départ.
const CATALOG_FROM = "2027-01-01";
const CATALOG_TO = "2027-06-30";

const statusSchema = z.enum(CATALOG_STATUSES);
const catalogIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

export async function brmCatalogRoutes(app: FastifyInstance) {
  app.get("/brm/catalog", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    let events;
    try {
      events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: VALID_DISTANCES });
    } catch {
      return reply.code(502).send({ error: "catalog_unavailable" });
    }

    const ids = events.map((e) => e.id);
    const participations = ids.length
      ? await prisma.brmParticipation.findMany({
          where: { catalogEventId: { in: ids } },
          include: { user: { select: { prenom: true } } },
        })
      : [];

    const byEvent = new Map<string, { displayName: string; status: string; mine: boolean }[]>();
    for (const p of participations) {
      const list = byEvent.get(p.catalogEventId) ?? [];
      list.push({ displayName: publicName(p.user), status: p.status, mine: p.userId === user.id });
      byEvent.set(p.catalogEventId, list);
    }

    const enriched = events.map((e) => {
      const participants = byEvent.get(e.id) ?? [];
      const mine = participants.find((p) => p.mine);
      return {
        ...e,
        participants: participants.map(({ displayName, status }) => ({ displayName, status })),
        myStatus: mine?.status ?? null,
      };
    });

    return reply.send({ events: enriched, window: { from: CATALOG_FROM, to: CATALOG_TO } });
  });

  app.put("/brm/catalog/:id/participation", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const bodyParsed = z.object({ status: statusSchema }).safeParse(request.body);
    if (!bodyParsed.success) return reply.code(400).send({ error: "invalid_input" });

    const participation = await prisma.brmParticipation.upsert({
      where: { userId_catalogEventId: { userId: user.id, catalogEventId: id } },
      create: { userId: user.id, catalogEventId: id, status: bodyParsed.data.status },
      update: { status: bodyParsed.data.status },
    });

    // Pas d'await sur l'ensemble : un fetch catalogue (quasi toujours en cache) ne doit
    // pas retarder la réponse à l'utilisateur qui vient de faire son choix.
    void fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: VALID_DISTANCES })
      .then((events) => {
        const match = events.find((e) => e.id === id);
        if (!match) return;
        return triggerWebhooks("brm.participation_changed", {
          who: publicName(user),
          status: participation.status,
          distance: match.distance,
          ville: match.ville,
          date: match.date,
        });
      })
      .catch(() => undefined);

    return reply.send({ status: participation.status });
  });

  app.delete("/brm/catalog/:id/participation", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    await prisma.brmParticipation.deleteMany({ where: { userId: user.id, catalogEventId: id } });
    return reply.code(204).send();
  });

  // Météo pour un BRM du calendrier ACP : basée sur la ville de l'événement (déjà
  // fournie par l'ACP), pas sur un tracé GPX — même mécanisme que la météo "Parcours"
  // d'un BRM saisi manuellement (voir src/routes/meteo.ts), juste une source d'id
  // différente puisque ces événements ne sont pas stockés en base.
  app.get("/brm/catalog/:id/meteo", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!config.openWeatherApiKey) return reply.code(503).send({ error: "not_configured" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    let events;
    try {
      events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: VALID_DISTANCES });
    } catch {
      return reply.code(502).send({ error: "catalog_unavailable" });
    }

    const match = events.find((e) => e.id === id);
    if (!match) return reply.code(404).send({ error: "not_found" });

    const weather = await fetchCityWeather(match.ville);
    if (!weather) return reply.code(502).send({ error: "meteo_unavailable" });

    return reply.send({ weather });
  });
}
