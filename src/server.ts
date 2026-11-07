import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { brmRoutes } from "./routes/brm.js";

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  app.register(cookie);

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    return payload;
  });

  app.register(authRoutes);
  app.register(brmRoutes);

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
