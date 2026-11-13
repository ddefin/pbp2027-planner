import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AdminError, adminGuard } from "../../lib/adminGuard.js";
import { adminUsersRoutes } from "./users.js";
import { adminSearchRoutes } from "./search.js";

// Toutes les routes déclarées sous ce plugin (préfixe /api/admin) : relues par les tests
// pour vérifier qu'AUCUNE n'est accessible sans le rôle ADMIN.
export const ADMIN_ROUTES: { method: string; url: string }[] = [];

export async function adminRoutes(app: FastifyInstance) {
  await app.register(
    async (admin) => {
      admin.addHook("onRoute", (r) => {
        for (const m of Array.isArray(r.method) ? r.method : [r.method]) if (m !== "HEAD") ADMIN_ROUTES.push({ method: m, url: r.url });
      });
      // La garde s'applique à toutes les routes de ce plugin, sans exception.
      admin.addHook("preHandler", adminGuard);
      admin.setErrorHandler((err, _request, reply) => {
        if (err instanceof AdminError) return reply.code(err.statusCode).send({ error: err.code });
        if (err instanceof ZodError) return reply.code(400).send({ error: "invalid_input", fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        const status = (err as { statusCode?: number }).statusCode;
        if (status && status < 500) return reply.code(status).send({ error: "invalid_input" });
        _request.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      });
      await admin.register(adminUsersRoutes);
      await admin.register(adminSearchRoutes);
    },
    { prefix: "/admin" },
  );
}
