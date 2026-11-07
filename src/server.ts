import "./lib/httpProxy.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { brmRoutes } from "./routes/brm.js";
import { brmCatalogRoutes } from "./routes/brmCatalog.js";
import { sortiesRoutes } from "./routes/sorties.js";
import { chatWsRoutes } from "./ws/chat.js";

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  app.register(cookie);
  app.register(websocket);

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    return payload;
  });

  // Tout sous /api : évite toute collision avec les routes côté client du frontend
  // (ex. /sorties existe à la fois comme route API et comme route React Router — sans
  // préfixe, un rechargement complet sur /sorties serait intercepté par le proxy et
  // renverrait la réponse de l'API au lieu de la page de l'app).
  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(brmRoutes);
      api.register(brmCatalogRoutes);
      api.register(sortiesRoutes);
      api.register(chatWsRoutes);
    },
    { prefix: "/api" },
  );

  app.get("/health", async () => ({ status: "ok" }));

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
}
