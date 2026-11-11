import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { NEWS_SOURCES, scrapeNews } from "../lib/newsScraper.js";

const querySchema = z.object({
  source: z.enum(NEWS_SOURCES).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function serialize(item: {
  id: string;
  source: string;
  title: string;
  url: string;
  excerpt: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  discoveredAt: Date;
}) {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    url: item.url,
    excerpt: item.excerpt,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
  };
}

export async function newsRoutes(app: FastifyInstance) {
  // Ouvert à tout utilisateur connecté (pas réservé à l'admin, contrairement aux
  // webhooks) : les actualités ACP/PBP concernent tout le monde.
  app.get("/news", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { source, q, limit } = parsed.data;

    const items = await prisma.newsItem.findMany({
      where: {
        ...(source ? { source } : {}),
        ...(q ? { OR: [{ title: { contains: q } }, { excerpt: { contains: q } }] } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit ?? 100,
    });

    // La date de dernière mise à jour est celle du dernier article vu PAR NOUS
    // (discoveredAt), pas la plus récente publishedAt affichée — distinction
    // utile si le scraping n'a pas tourné depuis un moment alors qu'un article
    // ancien vient seulement d'être inséré après un changement de format source.
    const latest = await prisma.newsItem.findFirst({ orderBy: { discoveredAt: "desc" }, select: { discoveredAt: true } });

    return reply.send({ items: items.map(serialize), lastUpdatedAt: latest?.discoveredAt.toISOString() ?? null });
  });

  // Déclenche un scraping immédiat plutôt que d'attendre le prochain passage
  // planifié (voir src/server.ts) — utile pour vérifier la configuration
  // Telegram/le scraping sans attendre jusqu'à 24h, voir le guide de test.
  // Réservé à l'admin : appelle les deux sites sources et peut diffuser sur
  // Telegram, pas quelque chose à exposer à tout utilisateur connecté.
  app.post("/news/refresh", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!user.isAdmin) return reply.code(403).send({ error: "forbidden" });

    const result = await scrapeNews();
    return reply.send(result);
  });
}
