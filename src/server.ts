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
import { webhooksRoutes } from "./routes/webhooks.js";
import { parcoursRoutes } from "./routes/parcours.js";
import { meteoRoutes } from "./routes/meteo.js";
import { messagingRoutes } from "./routes/messaging.js";
import { messagingWsRoutes } from "./ws/messaging.js";
import { newsRoutes } from "./routes/news.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { pbpRoutesRoutes } from "./routes/pbpRoutes.js";
import { roadbooksRoutes } from "./routes/roadbooks.js";
import { checkWindAlerts } from "./lib/windAlerts.js";
import { scrapeNews } from "./lib/newsScraper.js";
import { checkRoadbookAlerts } from "./lib/roadbookAlerts.js";
import { checkOfficialRoute } from "./lib/pbpRouteWatch.js";
import { startTelegramPolling } from "./lib/telegramBot.js";

const WIND_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NEWS_SCRAPE_INTERVAL_MS = config.newsScrapeIntervalHours * 60 * 60 * 1000;

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
  // (ex. /messagerie existe à la fois comme route API — préfixée ici — et comme route
  // React Router : sans préfixe, un rechargement complet sur une URL partagée par les
  // deux serait intercepté par le proxy et renverrait la réponse de l'API au lieu de
  // la page de l'app).
  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(profileRoutes);
      api.register(brmRoutes);
      api.register(brmCatalogRoutes);
      api.register(webhooksRoutes);
      api.register(parcoursRoutes);
      api.register(meteoRoutes);
      api.register(messagingRoutes);
      api.register(messagingWsRoutes);
      api.register(newsRoutes);
      api.register(notificationsRoutes);
      api.register(pbpRoutesRoutes);
      api.register(roadbooksRoutes);
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
    return { status: "ok", db: "ok", version: process.env.APP_VERSION ?? "dev" };
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

  // Même logique de décalage initial que checkWindAlerts ci-dessus. scrapeNews
  // est un no-op silencieux si les deux sites sources sont injoignables (voir
  // src/lib/newsScraper.ts), jamais bloquant pour le reste du serveur.
  setTimeout(() => {
    scrapeNews().catch((err) => app.log.error(err, "scrapeNews a échoué"));
    setInterval(() => {
      scrapeNews().catch((err) => app.log.error(err, "scrapeNews a échoué"));
    }, NEWS_SCRAPE_INTERVAL_MS);
  }, 60_000);

  // Alertes proactives du canal de suivi (silence, contrôle fermé, météo) toutes les 10 min,
  // et surveillance de la page officielle du parcours toutes les heures.
  setTimeout(() => {
    const alerts = () => checkRoadbookAlerts().catch((err) => app.log.error(err, "checkRoadbookAlerts a échoué"));
    const route = () => checkOfficialRoute().catch((err) => app.log.error(err, "checkOfficialRoute a échoué"));
    void alerts();
    void route();
    setInterval(alerts, 10 * 60_000);
    setInterval(route, 60 * 60_000);
  }, 90_000);

  // Pas de délai ici (contrairement aux deux ci-dessus) : c'est une boucle de
  // long-polling, pas un appel ponctuel — no-op immédiat si TELEGRAM_BOT_TOKEN
  // n'est pas configuré (voir src/lib/telegramBot.ts).
  startTelegramPolling();
}
