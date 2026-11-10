import "./lib/httpProxy.js";
import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { brmRoutes } from "./routes/brm.js";
import { brmCatalogRoutes } from "./routes/brmCatalog.js";
import { sortiesRoutes } from "./routes/sorties.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { parcoursRoutes } from "./routes/parcours.js";
import { meteoRoutes } from "./routes/meteo.js";
import { messagingRoutes } from "./routes/messaging.js";
import { chatWsRoutes } from "./ws/chat.js";
import { messagingWsRoutes } from "./ws/messaging.js";
import { checkWindAlerts } from "./lib/windAlerts.js";

const WIND_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  app.register(cookie);
  app.register(websocket);
  app.register(multipart);

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    // "same-origin" bloquait aussi le referer vers les tuiles OpenStreetMap
    // (carte Leaflet) — leur politique d'usage des tuiles refuse les requêtes qui
    // n'identifient pas le site appelant. "strict-origin-when-cross-origin" (le
    // défaut des navigateurs modernes) n'envoie que l'origine, pas le chemin, aux
    // sites tiers : reste prudent côté confidentialité tout en débloquant la carte.
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return payload;
  });

  // Tout sous /api : évite toute collision avec les routes côté client du frontend
  // (ex. /sorties existe à la fois comme route API et comme route React Router — sans
  // préfixe, un rechargement complet sur /sorties serait intercepté par le proxy et
  // renverrait la réponse de l'API au lieu de la page de l'app).
  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(profileRoutes);
      api.register(brmRoutes);
      api.register(brmCatalogRoutes);
      api.register(sortiesRoutes);
      api.register(webhooksRoutes);
      api.register(parcoursRoutes);
      api.register(meteoRoutes);
      api.register(messagingRoutes);
      api.register(chatWsRoutes);
      api.register(messagingWsRoutes);
    },
    { prefix: "/api" },
  );

  // Vérifie aussi la DB (pas juste que le process Node répond) : un monitoring externe
  // (Uptime Kuma, etc.) doit détecter une base verrouillée/corrompue, pas seulement un
  // conteneur arrêté.
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.code(503).send({ status: "degraded", db: "unreachable" });
    }
    return { status: "ok", db: "ok" };
  });

  // Sert le frontend déjà construit (web/dist) quand il existe, pour le déploiement en
  // un seul conteneur (même origine que l'API, conforme à l'architecture /api voulue).
  // Absent en dev courant (Vite tourne à part) : rien ne se branche, aucun effet de bord.
  const webDistDir = process.env.WEB_DIST_PATH ?? path.resolve(process.cwd(), "web/dist");
  if (existsSync(webDistDir)) {
    app.register(staticFiles, { root: webDistDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api") || request.raw.url === "/health") {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer();
  app
    .listen({ port: config.port, host: "0.0.0.0" })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });

  // Décalé après le démarrage (pas immédiat) pour ne pas ajouter de latence au
  // tout premier health check d'un conteneur qui vient de démarrer ; répété
  // ensuite, pas de sens à vérifier plus souvent que les prévisions ne changent.
  setTimeout(() => {
    checkWindAlerts().catch((err) => app.log.error(err, "checkWindAlerts a échoué"));
    setInterval(() => {
      checkWindAlerts().catch((err) => app.log.error(err, "checkWindAlerts a échoué"));
    }, WIND_ALERT_INTERVAL_MS);
  }, 60_000);
}
