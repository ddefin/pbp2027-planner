import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { fetchOpenRunnerStats } from "../lib/openrunner.js";
import { parseGpxStats } from "../lib/gpx.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 Mo : largement suffisant pour un GPX de 1200km

const updateSchema = z.object({
  sourceUrl: z.string().url().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

type ParcoursRecord = {
  id: string;
  brmEventId: string;
  sourceUrl: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
  notes: string | null;
  updatedAt: Date;
  createdAt: Date;
};

function serialize(p: ParcoursRecord) {
  return {
    id: p.id,
    brmEventId: p.brmEventId,
    sourceUrl: p.sourceUrl,
    fileName: p.fileName,
    hasFile: p.fileName !== null,
    distanceKm: p.distanceKm,
    elevationGainM: p.elevationGainM,
    elevationLossM: p.elevationLossM,
    minAltitudeM: p.minAltitudeM,
    maxAltitudeM: p.maxAltitudeM,
    notes: p.notes,
    updatedAt: p.updatedAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
  };
}

async function requireOwnedBrmEvent(userId: string, brmEventId: string) {
  return prisma.brmEvent.findFirst({ where: { id: brmEventId, userId } });
}

export async function parcoursRoutes(app: FastifyInstance) {
  app.get("/brm/:brmEventId/parcours", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await requireOwnedBrmEvent(user.id, brmEventId);
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const parcours = await prisma.parcours.findUnique({ where: { brmEventId } });
    return reply.send({ parcours: parcours ? serialize(parcours) : null });
  });

  app.put("/brm/:brmEventId/parcours", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await requireOwnedBrmEvent(user.id, brmEventId);
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const data = parsed.data;

    // Nouveau lien OpenRunner : on tente la récupération automatique tout de suite,
    // "best effort" — un échec ne bloque jamais l'enregistrement des autres champs.
    let autoStats: Awaited<ReturnType<typeof fetchOpenRunnerStats>> = null;
    if (data.sourceUrl) {
      autoStats = await fetchOpenRunnerStats(data.sourceUrl);
    }

    const parcours = await prisma.parcours.upsert({
      where: { brmEventId },
      create: {
        brmEventId,
        ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(autoStats ? {
          distanceKm: autoStats.distanceKm,
          elevationGainM: autoStats.elevationGainM,
          elevationLossM: autoStats.elevationLossM,
          minAltitudeM: autoStats.minAltitudeM,
          maxAltitudeM: autoStats.maxAltitudeM,
        } : {}),
      },
      update: {
        ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(autoStats ? {
          distanceKm: autoStats.distanceKm,
          elevationGainM: autoStats.elevationGainM,
          elevationLossM: autoStats.elevationLossM,
          minAltitudeM: autoStats.minAltitudeM,
          maxAltitudeM: autoStats.maxAltitudeM,
        } : {}),
      },
    });

    return reply.send({ parcours: serialize(parcours), autoFetched: autoStats !== null });
  });

  app.post("/brm/:brmEventId/parcours/upload", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await requireOwnedBrmEvent(user.id, brmEventId);
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const file = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!/\.gpx$/i.test(file.filename)) return reply.code(400).send({ error: "invalid_file_type" });

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const stats = parseGpxStats(buffer.toString("utf8"));

    const existing = await prisma.parcours.findUnique({ where: { brmEventId } });
    const filePath = await saveUploadedFile("parcours", buffer);
    if (existing?.filePath) await deleteUploadedFile(existing.filePath);

    const parcours = await prisma.parcours.upsert({
      where: { brmEventId },
      create: {
        brmEventId,
        fileName: file.filename,
        filePath,
        fileMimeType: "application/gpx+xml",
        ...(stats ? {
          distanceKm: stats.distanceKm,
          elevationGainM: stats.elevationGainM,
          elevationLossM: stats.elevationLossM,
          minAltitudeM: stats.minAltitudeM,
          maxAltitudeM: stats.maxAltitudeM,
        } : {}),
      },
      update: {
        fileName: file.filename,
        filePath,
        fileData: null, // écrase un éventuel ancien fichier stocké en base (voir src/lib/fileStorage.ts)
        fileMimeType: "application/gpx+xml",
        ...(stats ? {
          distanceKm: stats.distanceKm,
          elevationGainM: stats.elevationGainM,
          elevationLossM: stats.elevationLossM,
          minAltitudeM: stats.minAltitudeM,
          maxAltitudeM: stats.maxAltitudeM,
        } : {}),
      },
    });

    return reply.send({ parcours: serialize(parcours), statsParsed: stats !== null });
  });

  app.get("/brm/:brmEventId/parcours/file", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await requireOwnedBrmEvent(user.id, brmEventId);
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const parcours = await prisma.parcours.findUnique({ where: { brmEventId } });
    if (!parcours || !parcours.fileName || (!parcours.filePath && !parcours.fileData)) {
      return reply.code(404).send({ error: "no_file" });
    }

    // Lit sur disque si disponible (nouveaux uploads), sinon l'ancien stockage en
    // base (fichiers uploadés avant ce changement — voir src/lib/fileStorage.ts).
    const content = parcours.filePath ? await readUploadedFile(parcours.filePath) : parcours.fileData!;

    reply.header("content-type", parcours.fileMimeType ?? "application/gpx+xml");
    reply.header("content-disposition", `attachment; filename="${parcours.fileName.replace(/"/g, "")}"`);
    return reply.send(content);
  });

  app.delete("/brm/:brmEventId/parcours/file", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { brmEventId } = request.params as { brmEventId: string };
    const brmEvent = await requireOwnedBrmEvent(user.id, brmEventId);
    if (!brmEvent) return reply.code(404).send({ error: "not_found" });

    const existing = await prisma.parcours.findUnique({ where: { brmEventId } });
    if (existing?.filePath) await deleteUploadedFile(existing.filePath);

    await prisma.parcours.updateMany({
      where: { brmEventId },
      data: { fileName: null, fileData: null, filePath: null, fileMimeType: null },
    });
    return reply.code(204).send();
  });
}
