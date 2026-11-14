import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { parseGpxRoute, type GpxWaypoint } from "../lib/gpx.js";
import { projectFirstPassage, fromCompactPoint, projectOntoRoute, toCompactPoint, type CompactPoint, type RoutePoint } from "../lib/geo.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";
import { OFFICIAL_LIMIT_MINUTES } from "../lib/brm.js";
import { publicName } from "../lib/publicName.js";
import { looksLikeControl } from "../shared/roadbookCalc.js";
import { latestSituationMessage, recordCheckin, toWhatsAppText } from "../lib/roadbookSituation.js";
import { explainTelegramError, sendTelegram } from "../lib/telegram.js";
import { config } from "../config.js";
import { buildGpx, buildTcx } from "../lib/gpsExport.js";
import { liveView } from "../lib/roadbookLive.js";

const MAX_GPX_BYTES = 25 * 1024 * 1024;
const DEFAULT_STOP_MINUTES = 15;


const controlSchema = z.object({
  name: z.string().trim().min(1).max(80),
  km: z.number().min(0).max(5000),
  stopMinutes: z.number().int().min(0).max(600),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});

// Domaines Garmin acceptés pour le lien LiveTrack : ce lien est republié tel quel aux
// proches et sur le canal Telegram du groupe, pas question d'y laisser passer
// n'importe quelle URL (hameçonnage).
const LIVETRACK_HOSTS = new Set(["livetrack.garmin.com", "share.garmin.com", "connect.garmin.com", "gar.mn"]);
const liveTrackSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && LIVETRACK_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  });

const patchSchema = z.object({
  liveTrackUrl: liveTrackSchema.nullable().optional(),
  telegramAnnounce: z.boolean().optional(),
  groupShare: z.boolean().optional(),
  title: z.string().trim().min(1).max(100).optional(),
  classKm: z.number().int().min(50).max(1300).optional(),
  limitMinutes: z.number().int().min(60).max(6000).optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  movingSpeedKmh: z.number().min(8).max(45).optional(),
  climbPenaltyMinPer100m: z.number().min(0).max(30).optional(),
  controls: z.array(controlSchema).min(2).max(60).optional(),
  checklist: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1).max(120), done: z.boolean() })).max(60).optional(),
});

const checkinSchema = z.object({
  km: z.number().min(0).max(5000),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  source: z.enum(["gps", "manuel", "controle"]),
  // File hors réseau : heure réelle du pointage, identifiant anti-doublon, publication.
  at: z.string().datetime().optional(),
  clientId: z.string().min(8).max(64).optional(),
  announce: z.boolean().optional(),
});

type ControlEntry = z.infer<typeof controlSchema>;
type PoiEntry = { name: string; km: number; lat: number; lon: number };

// Titre lisible à partir du nom de fichier GPX : sans extension, sans les identifiants
// numériques ajoutés par les sites d'export (OpenRunner : "…_v3-25295972-1794154787-181"),
// séparateurs remplacés par des espaces, sigles usuels en majuscules.
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.gpx$/i, "").replace(/([-_ ]\d{5,})+(-\d+)*$/, "");
  // Nom "slug" sans espace (brm-300-chartres) : tirets = séparateurs. Avec des espaces,
  // on garde les tirets, qui font alors partie des noms (Nogent-le-Roi).
  const cleaned = (/\s/.test(base) ? base.replace(/_+/g, " ") : base.replace(/[-_]+/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(acp|brm|pbp|ffct|ffvelo)\b/gi, (m) => m.toUpperCase());
  const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return title.slice(0, 100) || "Mon BRM";
}

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
    const r = projectFirstPassage(points, w, fromIdx, 1000) ?? projectOntoRoute(points, w);
    fromIdx = r.segIndex;
    return { ...w, km: Math.round(r.km * 10) / 10, offsetKm: Math.round(r.distanceM / 100) / 10 };
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
    const isControl = looksLikeControl(w.name) && w.offsetKm <= 2;
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
    checklist: JSON.parse(r.checklist) as { id: string; label: string; done: boolean }[],
    distanceKm: r.distanceKm,
    elevationGainM: r.elevationGainM,
    elevationLossM: r.elevationLossM,
    fileName: r.fileName,
    shareToken: r.shareToken,
    liveTrackUrl: r.liveTrackUrl,
    telegramAnnounce: r.telegramAnnounce,
    groupShare: r.groupShare,
    announceStatus: {
      lastPublishedAt: r.lastAnnouncedAt?.toISOString() ?? null,
      lastAttemptAt: r.lastAnnounceAttemptAt?.toISOString() ?? null,
      lastError: r.lastAnnounceError,
      hint: r.lastAnnounceError ? explainTelegramError(r.lastAnnounceError) : null,
    },
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
        title: titleFromFileName(file.filename),
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
    const { controls, startAt, checklist, ...rest } = parsed.data;

    if (controls && controls.some((c) => c.km > r.distanceKm + 1)) return reply.code(400).send({ error: "control_beyond_route" });

    const updated = await prisma.roadbook.update({
      where: { id },
      data: {
        ...rest,
        ...(startAt !== undefined ? { startAt: startAt === null ? null : new Date(startAt) } : {}),
        ...(controls ? { controls: JSON.stringify([...controls].sort((a, b) => a.km - b.km)) } : {}),
        ...(checklist ? { checklist: JSON.stringify(checklist) } : {}),
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

  // Export pour compteur GPS : GPX (tracé + contrôles + points d'eau) ou TCX « Course »
  // (Garmin Connect, points de parcours avec alerte à l'approche).
  app.get("/roadbooks/:id/export", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const format = z.enum(["gpx", "tcx"]).safeParse((request.query as { format?: string }).format);
    if (!format.success) return reply.code(400).send({ error: "invalid_input" });
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const input = {
      title: r.title,
      startAt: r.startAt,
      settings: { movingSpeedKmh: r.movingSpeedKmh, climbPenaltyMinPer100m: r.climbPenaltyMinPer100m, classKm: r.classKm, limitMinutes: r.limitMinutes },
      controls: JSON.parse(r.controls) as ControlEntry[],
      pois: JSON.parse(r.pois) as PoiEntry[],
      points: (JSON.parse(r.points) as CompactPoint[]).map(fromCompactPoint),
    };
    const base = r.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "roadbook";
    reply.header("content-type", format.data === "gpx" ? "application/gpx+xml" : "application/vnd.garmin.tcx+xml");
    reply.header("content-disposition", `attachment; filename="${base}.${format.data}"`);
    return reply.send(format.data === "gpx" ? buildGpx(input) : buildTcx(input));
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

    // Publication sur le canal Telegram en arrière-plan : la réponse n'attend pas
    // OpenWeatherMap ni Telegram (voir src/lib/roadbookSituation.ts).
    // Heure réelle d'un pointage rattrapé : jamais dans le futur, pas plus de 7 jours.
    let at: Date | undefined;
    if (parsed.data.at) {
      const t = new Date(parsed.data.at).getTime();
      const now = Date.now();
      if (now - t > 7 * 86_400_000) return reply.code(400).send({ error: "invalid_input" });
      at = new Date(Math.min(t, now));
    }
    const { checkin, duplicate } = await recordCheckin(id, {
      km: parsed.data.km,
      lat: parsed.data.lat ?? null,
      lon: parsed.data.lon ?? null,
      source: parsed.data.source,
      at,
      clientId: parsed.data.clientId ?? null,
      announce: parsed.data.announce,
    });

    return reply.code(duplicate ? 200 : 201).send({ checkin: serializeCheckin(checkin), duplicate });
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

  // Résumé de situation (dernier pointage) au format WhatsApp, pour le bouton de partage :
  // WhatsApp n'a pas d'API pour publier dans un groupe, c'est la personne qui envoie.
  app.get("/roadbooks/:id/situation", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const r = await ownedRoadbook(id, user.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    const situation = await latestSituationMessage(id);
    if (!situation) return reply.code(404).send({ error: "no_checkin" });
    return reply.send({ whatsapp: toWhatsAppText(situation.html), at: situation.at.toISOString() });
  });

  // Test de publication sur le canal de suivi (admin) : envoie un message de test et
  // renvoie la réponse EXACTE de Telegram, avec l'action à faire en cas de refus.
  app.post("/roadbooks/telegram/test", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!user.isAdmin) return reply.code(403).send({ error: "forbidden" });

    const chatId = config.telegramTrackingChatId;
    const usingFallback = !process.env.TELEGRAM_TRACKING_CHAT_ID && Boolean(chatId);
    if (!config.telegramBotToken) return reply.send({ ok: false, chatId, usingFallback, error: "TELEGRAM_BOT_TOKEN absent", hint: "Renseigne TELEGRAM_BOT_TOKEN dans .env.production puis redémarre le conteneur." });
    if (!chatId)
      return reply.send({ ok: false, chatId: null, usingFallback, knownChats: [], error: "Aucun canal configuré", hint: "Ajoute TELEGRAM_TRACKING_CHAT_ID=-100… dans .env.production (fichier avec le point au début), puis : sudo docker compose up -d --force-recreate" });

    const knownChats = (await prisma.telegramChat.findMany({ orderBy: { updatedAt: "desc" } })).map((c) => ({
      chatId: c.chatId,
      title: c.title,
      type: c.type,
      botStatus: c.botStatus,
    }));
    const result = await sendTelegram(chatId, `✅ Test de publication depuis PBP2027 Planner (${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}) : les résumés de situation des randonneurs arriveront ici.`);
    return reply.send(
      result.ok
        ? { ok: true, chatId, usingFallback, knownChats }
        : { ok: false, chatId, usingFallback, knownChats, error: result.error, hint: explainTelegramError(result.error) },
    );
  });

  // Lien public en lecture seule : SANS session. N'expose ni email ni identifiant
  // interne de l'utilisateur, seulement le prénom affiché et ce que le roadbook
  // contient déjà (tracé, horaires, positions déclarées).
  // Même résumé pour les proches (lien de suivi), sans session.
  app.get("/roadbooks/shared/:token/situation", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return reply.code(404).send({ error: "not_found" });
    const r = await prisma.roadbook.findUnique({ where: { shareToken: token }, select: { id: true } });
    if (!r) return reply.code(404).send({ error: "not_found" });
    const situation = await latestSituationMessage(r.id);
    if (!situation) return reply.code(404).send({ error: "no_checkin" });
    reply.header("cache-control", "no-store");
    return reply.send({ whatsapp: toWhatsAppText(situation.html), at: situation.at.toISOString() });
  });

  // Vue en direct (heure d'arrivée, barrière, météo devant) pour la page de suivi.
  app.get("/roadbooks/shared/:token/live", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return reply.code(404).send({ error: "not_found" });
    const r = await prisma.roadbook.findUnique({ where: { shareToken: token }, select: { id: true } });
    if (!r) return reply.code(404).send({ error: "not_found" });
    const live = await liveView(r.id);
    if (!live) return reply.code(404).send({ error: "no_checkin" });
    reply.header("cache-control", "no-store");
    return reply.send(live);
  });

  app.get("/roadbooks/shared/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return reply.code(404).send({ error: "not_found" });
    const r = await prisma.roadbook.findUnique({ where: { shareToken: token }, include: { user: { select: { prenom: true } } } });
    if (!r) return reply.code(404).send({ error: "not_found" });
    const checkins = await prisma.roadbookCheckin.findMany({ where: { roadbookId: r.id }, orderBy: { at: "desc" }, take: 200 });
    const { shareToken: _token, id: _id, telegramAnnounce: _announce, announceStatus: _status, checklist: _checklist, groupShare: _group, ...rest } = serialize(r, true);
    reply.header("cache-control", "no-store");
    return reply.send({ roadbook: { ...rest, author: publicName(r.user) }, checkins: checkins.map(serializeCheckin) });
  });
}
