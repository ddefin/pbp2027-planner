import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { actorOf } from "../../lib/adminGuard.js";
import { avatarOf } from "../../lib/avatar.js";

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });

// Recherche globale de la palette Cmd+K : comptes, tracés PBP et traces de BRM.
export async function adminSearchRoutes(app: FastifyInstance) {
  app.get("/search", async (request, reply) => {
    actorOf(request);
    const { q } = searchQuery.parse(request.query);
    const [users, routes] = await Promise.all([
      prisma.user.findMany({
        where: { isSystem: false, OR: [{ prenom: { contains: q } }, { email: { contains: q.toLowerCase() } }] },
        select: { id: true, prenom: true, email: true, isAdmin: true, suspendedAt: true, avatar: true, avatarKey: true },
        orderBy: { prenom: "asc" },
        take: 8,
      }),
      prisma.pbpRoute.findMany({ where: { label: { contains: q } }, select: { id: true, label: true, kind: true }, take: 5 }),
    ]);
    return reply.send({
      users: users.map((u) => ({ id: u.id, prenom: u.prenom, email: u.email, isAdmin: u.isAdmin, suspended: Boolean(u.suspendedAt), avatar: avatarOf(u) })),
      pbpRoutes: routes,
    });
  });
}
