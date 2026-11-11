import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { parseGpxRoute, type GpxWaypoint } from "../lib/gpx.js";
import { fromCompactPoint, haversineMeters, toCompactPoint, type CompactPoint, type RoutePoint } from "../lib/geo.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";
import { OFFICIAL_LIMIT_MINUTES } from "../lib/brm.js";
import { publicName } from "../lib/publicName.js";

const MAX_GPX_BYTES = 25 * 1024 * 1024;
const MAX_CHECKINS_KEPT = 500;
const DEFAULT_STOP_MINUTES = 15;

// Même règle que looksLikeControl() dans web/src/lib/roadbook.ts (le backend ne peut
// pas importer le code du frontend) : à garder synchronisées.
const CONTROL_NAME = /(contr[oô]le|\bcp\s?\d*\b|check|pointage|tampon|control|d[ée]part|arriv[ée]e|start|finish|secret)/i;

const controlSchema = z.object({
  name: z.string().trim().min(1).max(80),
  km: z.number().min(0).max(5000),
  stopMinutes: z.number().int().min(0).max(600),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  classKm: z.number().int().min(50).max(1300).optional(),
  limitMinutes: z.number().int().min(60).max(6000).optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  movingSpeedKmh: z.number().min(8).max(45).optional(),
  climbPenaltyMinPer100m: z.number().min(0).max(30).optional(),
  controls: z.array(controlSchema).min(2).max(60).optional(),
});

const checkinSchema = z.object({
  km: z.number().min(0).max(5000),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  source: z.enum(["gps", "manuel", "controle"]),
});

type ControlEntry = z.infer<typeof controlSchema>;
type PoiEntry = { name: string; km: number; lat: number; lon: number };

// Distance nominale probable d'après la distance réelle du GPX : un brevet est souvent
// un peu plus long que sa distance nominale (un "200" de 205 à 220 km reste un 200,
// avec le délai de 13h30). Au-delà de +10 %, on ne devine pas : format sur-mesure.
export function guessClassKm(distanceKm: number): { classKm: number; limitMinutes: number } {
  for (const c of [200, 300, 400, 600]) {
    if (distanceKm >= c * 0.97 && distanceKm <= c * 1.1) return { classKm: c, limitMinutes: OFFICIAL_LIMIT_MINUTES[c] };
  }
  // Sur-mesure : délai au barème de fermeture (15 km/h), à ajuster par l'utilisateur.
  const classKm = Math.round(distanceKm);
  return { classKm, limitMinutes: Math.round((distanceKm / 15) * 60) };
}

// Projette les waypoints sur le tracé DANS L'ORDRE du fichier (qui suit presque
// toujours l'ordre du parcours) : sur un aller-retour, le contrôle de demi-tour et les
// points du retour seraient sinon tous rabattus sur l'aller, le point le plus proche
// étant ambigu. On cherche d'abord après le waypoint précédent ; sinon, partout.
function projectWaypoints(points: RoutePoint[], waypoints: GpxWaypoint[]): (GpxWaypoint & { km: number; offsetKm: number })[] {
  let fromIdx = 0;
  return waypoints.map((w) => {
    const scan = (start: number) => {
      let best = -1;
      let bestD = Infinity;
      for (let i = start; i < points.length; i++) {
        const d = haversineMeters(points[i], w);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return { best, bestD };
    };
    let r = scan(fromIdx);
    if (r.best === -1 || r.bestD > 2000) r = scan(0);
    fromIdx = r.best;
    return { ...w, km: Math.round(points[r.best].distKm * 10) / 10, offsetKm: Math.round(r.bestD / 100) / 10 };
  });
}

// Contrôles proposés à l'import : départ + waypoints nommés comme des contrôles +
// arrivée. Les autres waypoints deviennent des POI (affichés, sans horaire). Un
// waypoint "Départ"/"Arrivée" collé aux extrémités fait doublon : ignoré.
export function initialControls(points: RoutePoint[], waypoints: GpxWaypoint[]): { controls: ControlEntry[]; pois: PoiEntry[] } {
  const total = points[points.length - 1].distKm;
  const first = points[0];
  const last = points[points.length - 1];
  const controls: ControlEntry[] = [{ name: "Départ", km: 0, stopMinutes: 0, lat: first.lat, lon: first.lon }];
  const pois: PoiEntry[] = [];

  for (const w of projectWaypoints(points, waypoints)) {
    const isControl = CONTROL_NAME.test(w.name) && w.offsetKm <= 2;
    if (!isControl) {
      pois.push({ name: w.name, km: w.km, lat: w.lat, lon: w.lon });
      continue;
    }
    if (w.km < 0.5 || w.km > total - 0.5) continue;
    controls.push({ name: w.name, km: w.km, stopMinutes: DEFAULT_STOP_MINUTES, lat: w.lat, lon: w.lon });
  }

  controls.push({ name: "Arrivée", km: Math.round(total * 10) / 10, stopMinutes: 0, lat: last.lat, lon: last.lon });
  controls.sort((a, b) => a.km - b.km);
  return { controls, pois };
}

type RoadbookRow = Awaited<ReturnType<typeof prisma.roadbook.findUniqueOrThrow>>;

function serialize(r: RoadbookRow, withPoints: boolean) {
  return {
    id: r.id,
    title: r.title,
    classKm: r.classKm,
    limitMinutes: r.limitMinutes,
    startAt: r.startAt?.toISOString() ?? null,
    movingSpeedKmh: r.movingSpeedKmh,
    climbPenaltyMinPer100m: r.climbPenaltyMinPer100m,
    controls: JSON.parse(r.controls) as ControlEntry[],
    pois: JSON.parse(r.pois) as PoiEntry[],
    distanceKm: r.distanceKm,
    elevationGainM: r.elevationGainM,
    elevationLossM: r.elevationLossM,
    fileName: r.fileName,
    shareToken: r.shareToken,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(withPoints ? { points: JSON.parse(r.points) as CompactPoint[] } : {}),
  };
}

function serializeCheckin(c: { km: number; lat: number | null; lon: number | null; source: string; at: Date }) {
  return { km: c.km, lat: c.lat, lon: c.lon, source: c.source, at: c.at.toISOString() };
}

async function ownedRoadbook(id: string, userId: string) {
  const r = await prisma.roadbook.findUnique({ where: { id } });
  return r && r.userId === userId ? r : null;
}

export async function roadbooksRoutes(app: FastifyInstance) {
  app.get("/roadbooks", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const rows = await prisma.roadbook.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return reply.send({ roadbooks: rows.map((r) => serialize(r, false)) });
  });

  app.post("/roadbooks", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const file = await request.file({ limits: { fileSize: MAX_GPX_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!/\.gpx$/i.test(file.filename)) return reply.code(400).send({ error: "invalid_file_type" });
    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > MAX_GPX_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const parsed = parseGpxRoute(buffer.toString("utf8"));
    if (!parsed) return reply.code(422).send({ error: "unreadable_gpx" });

    const { classKm, limitMinutes } = guessClassKm(parsed.stats.distanceKm);
    const { controls, pois } = initialControls(parsed.points, parsed.waypoints);
    const filePath = await saveUploadedFile("roadbooks", buffer);

    const roadbook = await prisma.roadbook.create({
      data: {
        userId: user.id,
        title: file.filename.replace(/\.gpx$/i, "").slice(0, 100) || "Mon BRM",
        classKm,
        limitMinutes,
        controls: JSON.stringify(controls),
        pois: JSON.stringify(pois),
        points: JSON.stringify(parsed.points.map(toCompactPoint)),
        distanceKm: parsed.stats.distanceKm,
        elevationGainM: parsed.stats.elevationGainM,
        elevationLossM: parsed.stats.elevationLossM,
        fileName: file.filename,
        filePath,
      },
    });
    return reply.code(201).send({ roadbook: serialize(roadbook, false) });
  });

  app.get("/roadbooks/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const checkins = await prisma.roadbookCheckin.findMany({ where: { roadbookId: id }, orderBy: { at: "desc" }, take: 200 });
    return reply.send({ roadbook: serialize(r, true), checkins: checkins.map(serializeCheckin) });
  });

  app.patch("/roadbooks/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });

    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { controls, startAt, ...rest } = parsed.data;

    if (controls && controls.some((c) => c.km > r.distanceKm + 1)) return reply.code(400).send({ error: "control_beyond_route" });

    const updated = await prisma.roadbook.update({
      where: { id },
      data: {
        ...rest,
        ...(startAt !== undefined ? { startAt: startAt === null ? null : new Date(startAt) } : {}),
        ...(controls ? { controls: JSON.stringify([...controls].sort((a, b) => a.km - b.km)) } : {}),
      },
    });
    return reply.send({ roadbook: serialize(updated, false) });
  });

  app.delete("/roadbooks/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    await prisma.roadbook.delete({ where: { id } });
    await deleteUploadedFile(r.filePath).catch(() => undefined);
    return reply.code(204).send();
  });

  app.get("/roadbooks/:id/gpx", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    reply.header("content-type", "application/gpx+xml");
    reply.header("content-disposition", `attachment; filename="${r.fileName.replace(/"/g, "")}"`);
    return reply.send(await readUploadedFile(r.filePath));
  });

  // Activer = (re)générer un jeton : régénérer révoque l'ancien lien, utile si on l'a
  // partagé trop largement. Désactiver = plus aucun lien valide.
  app.post("/roadbooks/:id/share", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const shareToken = parsed.data.enabled ? randomBytes(16).toString("base64url") : null;
    await prisma.roadbook.update({ where: { id }, data: { shareToken } });
    return reply.send({ shareToken });
  });

  app.post("/roadbooks/:id/checkins", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const parsed = checkinSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.km > r.distanceKm + 1) return reply.code(400).send({ error: "invalid_input" });

    const checkin = await prisma.roadbookCheckin.create({
      data: { roadbookId: id, km: parsed.data.km, lat: parsed.data.lat ?? null, lon: parsed.data.lon ?? null, source: parsed.data.source },
    });

    // Historique borné : un suivi GPS sur un 600 peut produire beaucoup de positions.
    const old = await prisma.roadbookCheckin.findMany({
      where: { roadbookId: id },
      orderBy: { at: "desc" },
      skip: MAX_CHECKINS_KEPT,
      select: { id: true },
    });
    if (old.length) await prisma.roadbookCheckin.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

    return reply.code(201).send({ checkin: serializeCheckin(checkin) });
  });

  // Nouvelle tentative / remise à zéro du suivi (le roadbook lui-même est conservé).
  app.delete("/roadbooks/:id/checkins", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    await prisma.roadbookCheckin.deleteMany({ where: { roadbookId: id } });
    return reply.code(204).send();
  });

  // Lien public en lecture seule : SANS session. N'expose ni email ni identifiant
  // interne de l'utilisateur, seulement le prénom affiché et ce que le roadbook
  // contient déjà (tracé, horaires, positions déclarées).
  app.get("/roadbooks/shared/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return reply.code(404).send({ error: "not_found" });
    const r = await prisma.roadbook.findUnique({ where: { shareToken: token }, include: { user: { select: { prenom: true } } } });
    if (!r) return reply.code(404).send({ error: "not_found" });
    const checkins = await prisma.roadbookCheckin.findMany({ where: { roadbookId: r.id }, orderBy: { at: "desc" }, take: 200 });
    const { shareToken: _token, id: _id, ...rest } = serialize(r, true);
    reply.header("cache-control", "no-store");
    return reply.send({ roadbook: { ...rest, author: publicName(r.user) }, checkins: checkins.map(serializeCheckin) });
  });
}

// Exporté pour les tests : décodage des points stockés.
export function decodePoints(json: string): RoutePoint[] {
  return (JSON.parse(json) as CompactPoint[]).map(fromCompactPoint);
}
