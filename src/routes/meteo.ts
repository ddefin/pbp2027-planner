import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { fetchCityWeather } from "../lib/openWeather.js";
import { config } from "../config.js";

export async function meteoRoutes(app: FastifyInstance) {
  app.get("/brm/:brmEventId/meteo", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    if (!config.openWeatherApiKey) return reply.code(503).send({ error: "not_configured" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await prisma.brmEvent.findFirst({ where: { id: brmEventId, userId: user.id } });
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const weather = await fetchCityWeather(brmEvent.lieu);
    if (!weather) return reply.code(502).send({ error: "meteo_unavailable" });

    return reply.send({ weather });
  });
}
