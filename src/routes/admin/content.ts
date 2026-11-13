import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { AdminError, actorOf, limitDeletions } from "../../lib/adminGuard.js";
import { auditEntry } from "../../lib/audit.js";
import { deleteUploadedFile } from "../../lib/fileStorage.js";
import { broadcast, GENERAL_ROOM_KEY } from "../../ws/messaging.js";
import { contentDeleteSchema, idParam, listQuery } from "../../shared/adminSchemas.js";

const author = (u: { prenom: string; email: string; isSystem: boolean }) => (u.isSystem ? "Membre supprimé" : `${u.prenom} (${u.email})`);
const excerpt = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const authorSelect = { select: { prenom: true, email: true, isSystem: true } } as const;

// Modération : messages du salon général, tracés PBP, traces GPX des BRM du calendrier.
// Les roadbooks restent hors modération (données personnelles du randonneur).
export async function adminContentRoutes(app: FastifyInstance) {
  app.get("/content/messages", async (request, reply) => {
    actorOf(request);
    const q = listQuery.parse(request.query);
    const where = q.q ? { OR: [{ text: { contains: q.q } }, { fileName: { contains: q.q } }, { user: { prenom: { contains: q.q } } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.groupMessage.count({ where }),
      prisma.groupMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, text: true, kind: true, fileName: true, createdAt: true, user: authorSelect } }),
    ]);
    return reply.send({
      items: rows.map((m) => ({ id: m.id, text: excerpt(m.text || (m.kind === "location" ? "📍 Position partagée" : "")), kind: m.kind, fileName: m.fileName, author: author(m.user), at: m.createdAt.toISOString() })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  app.post("/content/messages/:id/delete", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { reason } = contentDeleteSchema.parse(request.body);
    limitDeletions(actor, "content");
    const m = await prisma.groupMessage.findUnique({ where: { id }, include: { user: authorSelect } });
    if (!m) throw new AdminError(404, "not_found");
    await prisma.$transaction([
      prisma.groupMessage.delete({ where: { id } }),
      auditEntry(request, actor, { action: "content.delete", targetType: "message", targetId: id, targetLabel: `Message de ${author(m.user)}`, metadata: { reason, excerpt: excerpt(m.text, 200), fileName: m.fileName } }),
    ]);
    if (m.filePath) await deleteUploadedFile(m.filePath).catch(() => undefined);
    broadcast(GENERAL_ROOM_KEY, { type: "message_deleted", id });
    return reply.send({ ok: true });
  });

  app.get("/content/pbp-routes", async (request, reply) => {
    actorOf(request);
    const q = listQuery.parse(request.query);
    const where = q.q ? { OR: [{ label: { contains: q.q } }, { fileName: { contains: q.q } }, { kind: { contains: q.q } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.pbpRoute.count({ where }),
      prisma.pbpRoute.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, label: true, kind: true, fileName: true, distanceKm: true, createdAt: true, uploadedBy: authorSelect } }),
    ]);
    return reply.send({
      items: rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, fileName: r.fileName, distanceKm: Math.round(r.distanceKm), author: author(r.uploadedBy), at: r.createdAt.toISOString() })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  app.post("/content/pbp-routes/:id/delete", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { reason } = contentDeleteSchema.parse(request.body);
    limitDeletions(actor, "content");
    const r = await prisma.pbpRoute.findUnique({ where: { id }, include: { uploadedBy: authorSelect } });
    if (!r) throw new AdminError(404, "not_found");
    await prisma.$transaction([
      prisma.pbpRoute.delete({ where: { id } }),
      auditEntry(request, actor, { action: "content.delete", targetType: "pbp_route", targetId: id, targetLabel: `Tracé PBP « ${r.label} »`, metadata: { reason, kind: r.kind, author: author(r.uploadedBy) } }),
    ]);
    await deleteUploadedFile(r.filePath).catch(() => undefined);
    return reply.send({ ok: true });
  });

  // Traces GPX déposées sur les BRM du calendrier : trace principale et variantes.
  app.get("/content/brm-tracks", async (request, reply) => {
    actorOf(request);
    const q = listQuery.parse(request.query);
    const whereT = q.q ? { OR: [{ fileName: { contains: q.q } }, { catalogEventId: { contains: q.q } }] } : {};
    const whereV = q.q ? { OR: [{ fileName: { contains: q.q } }, { label: { contains: q.q } }, { catalogEventId: { contains: q.q } }] } : {};
    const [tracks, variants] = await Promise.all([
      prisma.catalogTrack.findMany({ where: whereT, select: { id: true, catalogEventId: true, fileName: true, distanceKm: true, createdAt: true, uploadedBy: authorSelect } }),
      prisma.catalogTrackVariant.findMany({ where: whereV, select: { id: true, catalogEventId: true, label: true, fileName: true, distanceKm: true, createdAt: true, uploadedBy: authorSelect } }),
    ]);
    // Deux tables, une liste : fusion triée puis paginée côté serveur (quelques centaines de traces au plus).
    const all = [
      ...tracks.map((t) => ({ id: `t_${t.id}`, type: "principale" as const, label: t.fileName, catalogEventId: t.catalogEventId, distanceKm: t.distanceKm ? Math.round(t.distanceKm) : null, author: author(t.uploadedBy), at: t.createdAt })),
      ...variants.map((v) => ({ id: `v_${v.id}`, type: "variante" as const, label: `${v.label} (${v.fileName})`, catalogEventId: v.catalogEventId, distanceKm: v.distanceKm ? Math.round(v.distanceKm) : null, author: author(v.uploadedBy), at: v.createdAt })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return reply.send({
      items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((x) => ({ ...x, at: x.at.toISOString() })),
      total: all.length,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  app.post("/content/brm-tracks/:id/delete", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    const { reason } = contentDeleteSchema.parse(request.body);
    limitDeletions(actor, "content");
    const [kind, rawId] = [id.slice(0, 2), id.slice(2)];
    if (kind === "t_") {
      const t = await prisma.catalogTrack.findUnique({ where: { id: rawId }, include: { uploadedBy: authorSelect } });
      if (!t) throw new AdminError(404, "not_found");
      await prisma.$transaction([
        prisma.catalogTrack.delete({ where: { id: rawId } }),
        auditEntry(request, actor, { action: "content.delete", targetType: "brm_track", targetId: rawId, targetLabel: `Trace BRM ${t.catalogEventId} (${t.fileName})`, metadata: { reason, author: author(t.uploadedBy) } }),
      ]);
    } else if (kind === "v_") {
      const v = await prisma.catalogTrackVariant.findUnique({ where: { id: rawId }, include: { uploadedBy: authorSelect } });
      if (!v) throw new AdminError(404, "not_found");
      await prisma.$transaction([
        prisma.catalogTrackVariant.delete({ where: { id: rawId } }),
        auditEntry(request, actor, { action: "content.delete", targetType: "brm_variant", targetId: rawId, targetLabel: `Variante BRM « ${v.label} »`, metadata: { reason, author: author(v.uploadedBy) } }),
      ]);
    } else throw new AdminError(404, "not_found");
    return reply.send({ ok: true });
  });
}
