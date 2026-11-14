import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { fetchFranceBrmCatalog } from "../lib/acpCatalog.js";
import { CATALOG_FROM, CATALOG_STATUSES, CATALOG_TO, CALENDAR_DISTANCES } from "../lib/brm.js";
import { publicName } from "../lib/publicName.js";
import { AVATAR_SELECT, avatarOf } from "../lib/avatar.js";
import { QUALIFYING_STEPS, qualifiedSteps, stepFor } from "../shared/qualification.js";
import { triggerWebhooks } from "../lib/webhooks.js";
import { fetchCityWeather } from "../lib/openWeather.js";
import { config } from "../config.js";
import { parseGpxStats, parseGpxProfile } from "../lib/gpx.js";
import { notifyUser } from "../lib/notify.js";

// Formulations à la 2e personne pour la notification personnalisée (distinct du
// texte de EVENT_LABEL/humanText dans src/lib/webhooks.ts, qui s'adresse au
// groupe et parle de l'utilisateur à la 3e personne).
const STATUS_LABEL: Record<string, string> = {
  prevu: "prévu",
  inscrit: "inscrit",
  fait: "fait",
  homologue: "homologué",
};

// Fenêtre de qualification PBP 2027 demandée : saison précédant le départ.

const statusSchema = z.enum(CATALOG_STATUSES);
const catalogIdSchema = z.string().regex(/^[0-9a-f]{16}$/);
const MAX_TRACK_FILE_BYTES = 5 * 1024 * 1024; // 5 Mo : largement suffisant pour un GPX de 1200km

const CONTROL_POINT_KINDS = ["depart", "ravito", "controle", "arrivee"] as const;
const controlPointSchema = z.object({
  kind: z.enum(CONTROL_POINT_KINDS),
  label: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

// Identifiant opaque et stable d'un randonneur dans le calendrier : distingue deux
// homonymes (même prénom) sans exposer ni l'email ni l'id interne du compte.
function memberKeyOf(userId: string): string {
  return createHmac("sha256", config.mfaEncryptionKeyHex).update(`brm-member:${userId}`).digest("base64url").slice(0, 12);
}

export async function brmCatalogRoutes(app: FastifyInstance) {
  // Qualification PBP du randonneur connecté : BRM perso ET BRM du calendrier marqués
  // « Homologué ». Un 1000 vaut pour l'étape 600 (src/shared/qualification.ts). Si le
  // calendrier ACP est injoignable, on compte ce qu'on sait (BRM perso) et on le signale.
  app.get("/brm/qualification", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const [personal, participations] = await Promise.all([
      prisma.brmEvent.findMany({ where: { userId: user.id, status: "homologue" }, select: { distance: true, date: true, lieu: true } }),
      prisma.brmParticipation.findMany({ where: { userId: user.id, status: "homologue" }, select: { catalogEventId: true } }),
    ]);

    let catalogAvailable = true;
    let fromCalendar: { distance: number; date: string; ville: string }[] = [];
    if (participations.length) {
      try {
        const events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES });
        const wanted = new Set(participations.map((p) => p.catalogEventId));
        fromCalendar = events.filter((e) => wanted.has(e.id)).map((e) => ({ distance: e.distance, date: e.date, ville: e.ville }));
      } catch {
        catalogAvailable = false;
      }
    }

    const all = [
      ...personal.map((e) => ({ distance: e.distance, status: "homologue", date: e.date.toISOString().slice(0, 10), lieu: e.lieu, source: "perso" as const })),
      ...fromCalendar.map((e) => ({ distance: e.distance, status: "homologue", date: e.date, lieu: e.ville, source: "calendrier" as const })),
    ];
    const steps = qualifiedSteps(all);
    return reply.send({
      total: QUALIFYING_STEPS.length,
      steps: QUALIFYING_STEPS.map((step) => {
        const by = all.filter((e) => stepFor(e.distance) === step).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
        return { step, done: steps.has(step), by: by && { distance: by.distance, date: by.date, lieu: by.lieu, source: by.source } };
      }),
      catalogAvailable,
    });
  });

  app.get("/brm/catalog", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    let events;
    try {
      events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES });
    } catch {
      return reply.code(502).send({ error: "catalog_unavailable" });
    }

    const ids = events.map((e) => e.id);
    const participations = ids.length
      ? await prisma.brmParticipation.findMany({
          where: { catalogEventId: { in: ids } },
          include: { user: { select: { prenom: true, ...AVATAR_SELECT } } },
        })
      : [];

    const byEvent = new Map<string, { displayName: string; status: string; mine: boolean; memberKey: string; avatar: ReturnType<typeof avatarOf> }[]>();
    for (const p of participations) {
      const list = byEvent.get(p.catalogEventId) ?? [];
      list.push({ displayName: publicName(p.user), status: p.status, mine: p.userId === user.id, memberKey: memberKeyOf(p.userId), avatar: avatarOf(p.user) });
      byEvent.set(p.catalogEventId, list);
    }

    const enriched = events.map((e) => {
      const participants = byEvent.get(e.id) ?? [];
      const mine = participants.find((p) => p.mine);
      return {
        ...e,
        participants: participants.map(({ displayName, status, mine: isMine, memberKey, avatar }) => ({ displayName, status, mine: isMine, memberKey, avatar })),
        myStatus: mine?.status ?? null,
      };
    });

    return reply.send({ events: enriched, window: { from: CATALOG_FROM, to: CATALOG_TO } });
  });

  app.put("/brm/catalog/:id/participation", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const bodyParsed = z.object({ status: statusSchema }).safeParse(request.body);
    if (!bodyParsed.success) return reply.code(400).send({ error: "invalid_input" });

    const participation = await prisma.brmParticipation.upsert({
      where: { userId_catalogEventId: { userId: user.id, catalogEventId: id } },
      create: { userId: user.id, catalogEventId: id, status: bodyParsed.data.status },
      update: { status: bodyParsed.data.status },
    });

    // Pas d'await sur l'ensemble : un fetch catalogue (quasi toujours en cache) ne doit
    // pas retarder la réponse à l'utilisateur qui vient de faire son choix.
    void fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES })
      .then((events) => {
        const match = events.find((e) => e.id === id);
        if (!match) return;
        const dateLabel = new Date(match.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        return Promise.all([
          triggerWebhooks("brm.participation_changed", {
            who: publicName(user),
            status: participation.status,
            distance: match.distance,
            ville: match.ville,
            date: match.date,
          }),
          notifyUser(
            user.id,
            "brm_status",
            `Bonjour ${user.prenom}, ton statut sur le BRM ${match.distance} km de ${match.ville} (${dateLabel}) est maintenant : ${STATUS_LABEL[participation.status] ?? participation.status}.`,
            "/calendrier",
          ),
        ]);
      })
      .catch(() => undefined);

    return reply.send({ status: participation.status });
  });

  app.delete("/brm/catalog/:id/participation", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    await prisma.brmParticipation.deleteMany({ where: { userId: user.id, catalogEventId: id } });

    void fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES })
      .then((events) => {
        const match = events.find((e) => e.id === id);
        if (!match) return;
        const dateLabel = new Date(match.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        return notifyUser(
          user.id,
          "brm_status",
          `Bonjour ${user.prenom}, tu as retiré ton choix sur le BRM ${match.distance} km de ${match.ville} (${dateLabel}).`,
          "/calendrier",
        );
      })
      .catch(() => undefined);

    return reply.code(204).send();
  });

  // Météo pour un BRM du calendrier ACP : basée sur la ville de l'événement (déjà
  // fournie par l'ACP), pas sur un tracé GPX — même mécanisme que la météo "Parcours"
  // d'un BRM saisi manuellement (voir src/routes/meteo.ts), juste une source d'id
  // différente puisque ces événements ne sont pas stockés en base.
  app.get("/brm/catalog/:id/meteo", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!config.openWeatherApiKey) return reply.code(503).send({ error: "not_configured" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    let events;
    try {
      events = await fetchFranceBrmCatalog({ from: CATALOG_FROM, to: CATALOG_TO, distances: CALENDAR_DISTANCES });
    } catch {
      return reply.code(502).send({ error: "catalog_unavailable" });
    }

    const match = events.find((e) => e.id === id);
    if (!match) return reply.code(404).send({ error: "not_found" });

    const weather = await fetchCityWeather(match.ville);
    if (!weather) return reply.code(502).send({ error: "meteo_unavailable" });

    return reply.send({ weather });
  });

  // Tracé GPX d'un BRM du calendrier : un seul par événement, partagé par tout le
  // groupe (voir le commentaire du modèle CatalogTrack) — n'importe quel randonneur
  // connecté peut l'ajouter ou le remplacer.
  app.get("/brm/catalog/:id/track", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const track = await prisma.catalogTrack.findUnique({ where: { catalogEventId: id } });
    if (!track) return reply.code(404).send({ error: "not_found" });

    return reply.send({
      track: {
        fileName: track.fileName,
        points: JSON.parse(track.points),
        distanceKm: track.distanceKm,
        elevationGainM: track.elevationGainM,
        elevationLossM: track.elevationLossM,
      },
    });
  });

  app.post("/brm/catalog/:id/track", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const file = await request.file({ limits: { fileSize: MAX_TRACK_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!/\.gpx$/i.test(file.filename)) return reply.code(400).send({ error: "invalid_file_type" });

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_TRACK_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const xml = buffer.toString("utf8");
    const points = parseGpxProfile(xml);
    if (!points) return reply.code(422).send({ error: "unreadable_gpx" });
    const stats = parseGpxStats(xml);

    const track = await prisma.catalogTrack.upsert({
      where: { catalogEventId: id },
      create: {
        catalogEventId: id,
        uploadedByUserId: user.id,
        fileName: file.filename,
        points: JSON.stringify(points),
        distanceKm: stats?.distanceKm ?? null,
        elevationGainM: stats?.elevationGainM ?? null,
        elevationLossM: stats?.elevationLossM ?? null,
      },
      update: {
        uploadedByUserId: user.id,
        fileName: file.filename,
        points: JSON.stringify(points),
        distanceKm: stats?.distanceKm ?? null,
        elevationGainM: stats?.elevationGainM ?? null,
        elevationLossM: stats?.elevationLossM ?? null,
      },
    });

    return reply.send({
      track: {
        fileName: track.fileName,
        points,
        distanceKm: track.distanceKm,
        elevationGainM: track.elevationGainM,
        elevationLossM: track.elevationLossM,
      },
    });
  });

  app.delete("/brm/catalog/:id/track", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const existing = await prisma.catalogTrack.findUnique({ where: { catalogEventId: id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    // Seul celui qui l'a ajouté peut le retirer — évite qu'un randonneur supprime par
    // erreur (ou mégarde) le tracé qu'un autre vient de partager au groupe.
    if (existing.uploadedByUserId !== user.id) return reply.code(403).send({ error: "forbidden" });

    await prisma.catalogTrack.delete({ where: { catalogEventId: id } });
    return reply.code(204).send();
  });

  // Points de ravito/contrôle/départ/arrivée pour un BRM du calendrier : collectifs
  // (visibles par tous, voir CatalogTrack), mais chacun ne peut retirer que les siens
  // — contrairement au tracé de référence, plusieurs personnes posent des points
  // indépendamment, pas de notion de "remplacer celui d'un autre".
  app.get("/brm/catalog/:id/control-points", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const points = await prisma.catalogControlPoint.findMany({
      where: { catalogEventId: id },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      points: points.map((p) => ({
        id: p.id,
        kind: p.kind,
        label: p.label,
        lat: p.lat,
        lon: p.lon,
        mine: p.createdByUserId === user.id,
      })),
    });
  });

  app.post("/brm/catalog/:id/control-points", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const parsed = controlPointSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const point = await prisma.catalogControlPoint.create({
      data: { catalogEventId: id, createdByUserId: user.id, ...parsed.data },
    });

    return reply.code(201).send({
      point: { id: point.id, kind: point.kind, label: point.label, lat: point.lat, lon: point.lon, mine: true },
    });
  });

  app.delete("/brm/catalog/:id/control-points/:pointId", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { pointId } = request.params as { id: string; pointId: string };
    const point = await prisma.catalogControlPoint.findUnique({ where: { id: pointId } });
    if (!point) return reply.code(404).send({ error: "not_found" });
    if (point.createdByUserId !== user.id) return reply.code(403).send({ error: "forbidden" });

    await prisma.catalogControlPoint.delete({ where: { id: pointId } });
    return reply.code(204).send();
  });

  // Variantes de tracé : contrairement à CatalogTrack (LE tracé de référence,
  // remplaçable par n'importe qui), plusieurs variantes peuvent coexister pour
  // comparer des options — voir le commentaire du modèle CatalogTrackVariant.
  app.get("/brm/catalog/:id/track-variants", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const variants = await prisma.catalogTrackVariant.findMany({
      where: { catalogEventId: id },
      include: { uploadedBy: { select: { prenom: true } } },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      variants: variants.map((v) => ({
        id: v.id,
        label: v.label,
        fileName: v.fileName,
        points: JSON.parse(v.points),
        distanceKm: v.distanceKm,
        elevationGainM: v.elevationGainM,
        elevationLossM: v.elevationLossM,
        uploadedBy: publicName(v.uploadedBy),
        mine: v.uploadedByUserId === user.id,
      })),
    });
  });

  app.post("/brm/catalog/:id/track-variants", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    if (!catalogIdSchema.safeParse(id).success) return reply.code(400).send({ error: "invalid_id" });

    const file = await request.file({ limits: { fileSize: MAX_TRACK_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!/\.gpx$/i.test(file.filename)) return reply.code(400).send({ error: "invalid_file_type" });

    // Champ texte envoyé dans le même multipart que le fichier (voir @fastify/multipart) :
    // le libellé de la variante (ex. "Évite Nogent"), pas de valeur par défaut utile.
    const labelField = (file.fields?.label as { value?: unknown } | undefined)?.value;
    const label = typeof labelField === "string" && labelField.trim() ? labelField.trim().slice(0, 100) : file.filename;

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_TRACK_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const xml = buffer.toString("utf8");
    const points = parseGpxProfile(xml);
    if (!points) return reply.code(422).send({ error: "unreadable_gpx" });
    const stats = parseGpxStats(xml);

    const variant = await prisma.catalogTrackVariant.create({
      data: {
        catalogEventId: id,
        uploadedByUserId: user.id,
        label,
        fileName: file.filename,
        points: JSON.stringify(points),
        distanceKm: stats?.distanceKm ?? null,
        elevationGainM: stats?.elevationGainM ?? null,
        elevationLossM: stats?.elevationLossM ?? null,
      },
    });

    return reply.code(201).send({
      variant: {
        id: variant.id,
        label: variant.label,
        fileName: variant.fileName,
        points,
        distanceKm: variant.distanceKm,
        elevationGainM: variant.elevationGainM,
        elevationLossM: variant.elevationLossM,
        uploadedBy: publicName(user),
        mine: true,
      },
    });
  });

  app.delete("/brm/catalog/:id/track-variants/:variantId", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { variantId } = request.params as { id: string; variantId: string };
    const variant = await prisma.catalogTrackVariant.findUnique({ where: { id: variantId } });
    if (!variant) return reply.code(404).send({ error: "not_found" });
    if (variant.uploadedByUserId !== user.id) return reply.code(403).send({ error: "forbidden" });

    await prisma.catalogTrackVariant.delete({ where: { id: variantId } });
    return reply.code(204).send();
  });
}
