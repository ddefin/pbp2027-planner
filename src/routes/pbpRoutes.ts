import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getSessionUser } from "../lib/session.js";
import { parseGpxRoute, type GpxWaypoint } from "../lib/gpx.js";
import { fromCompactPoint, projectOntoRoute, toCompactPoint, type CompactPoint, type RoutePoint } from "../lib/geo.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";
import { PBP_2027_CONTROLS, PBP_2027_TOTAL_KM, PBP_2027_WAVES, buildIndicativeRoute, projectControls, type ProjectedControl } from "../lib/pbpControls.js";
import { computeRouteWeather } from "../lib/routeWeather.js";
import { fetchForecastAt } from "../lib/openWeather.js";

export const ROUTE_KINDS = ["officiel", "provisoire", "communautaire"] as const;
type RouteKind = (typeof ROUTE_KINDS)[number];
const KIND_RANK: Record<string, number> = { officiel: 3, provisoire: 2, communautaire: 1 };
export const INDICATIVE_ROUTE_ID = "indicatif";

// Un GPX de 1200 km enregistré à la seconde dépasse vite 10 Mo ; 25 Mo laisse de la
// marge sans permettre d'abuser du stockage du NAS.
const MAX_GPX_BYTES = 25 * 1024 * 1024;

const patchSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(ROUTE_KINDS).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const weatherQuerySchema = z.object({
  start: z.string().datetime({ offset: true }),
  speed: z.coerce.number().min(5).max(45),
  step: z.coerce.number().min(20).max(200).default(60),
});

const pointQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

const toCompact = toCompactPoint;
const fromCompact = fromCompactPoint;

type StoredRoute = {
  id: string;
  label: string;
  kind: string;
  description: string | null;
  fileName: string;
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  rawPointCount: number;
  uploadedByUserId: string;
  uploadedBy?: { prenom: string };
  createdAt: Date;
};

function serializeMeta(r: StoredRoute, userId: string, isAdmin: boolean) {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    description: r.description,
    fileName: r.fileName,
    distanceKm: r.distanceKm,
    elevationGainM: r.elevationGainM,
    elevationLossM: r.elevationLossM,
    rawPointCount: r.rawPointCount,
    uploadedBy: r.uploadedBy?.prenom ?? null,
    createdAt: r.createdAt.toISOString(),
    canDelete: isAdmin || r.uploadedByUserId === userId,
  };
}

// Tout sauf points/waypoints : la liste doit rester légère, le tracé complet n'est
// chargé que pour le(s) tracé(s) effectivement affiché(s).
const META_SELECT = {
  id: true,
  label: true,
  kind: true,
  description: true,
  fileName: true,
  distanceKm: true,
  elevationGainM: true,
  elevationLossM: true,
  rawPointCount: true,
  uploadedByUserId: true,
  createdAt: true,
  uploadedBy: { select: { prenom: true } },
} as const;

const indicative = buildIndicativeRoute();
const INDICATIVE_META = {
  id: INDICATIVE_ROUTE_ID,
  label: "Tracé indicatif (contrôles 2027)",
  kind: "indicatif",
  description:
    "Liaisons à vol d'oiseau entre les villes de contrôle publiées, kilométrage recalé sur les distances officielles connues. Ce n'est pas un itinéraire : en attente du GPX officiel.",
  fileName: "",
  distanceKm: PBP_2027_TOTAL_KM,
  elevationGainM: null,
  elevationLossM: null,
  rawPointCount: indicative.points.length,
  uploadedBy: null,
  createdAt: new Date(0).toISOString(),
  canDelete: false,
};

// Choix du tracé par défaut : rang le plus élevé, puis le plus récent. Le tracé
// indicatif n'est le défaut que tant qu'aucun GPX n'a été importé.
export function pickDefaultRouteId(routes: { id: string; kind: string; createdAt: Date }[]): string {
  const sorted = [...routes].sort((a, b) => (KIND_RANK[b.kind] ?? 0) - (KIND_RANK[a.kind] ?? 0) || b.createdAt.getTime() - a.createdAt.getTime());
  return sorted[0]?.id ?? INDICATIVE_ROUTE_ID;
}

async function loadRoutePoints(id: string): Promise<{ points: RoutePoint[]; waypoints: GpxWaypoint[]; controls: ProjectedControl[] } | null> {
  if (id === INDICATIVE_ROUTE_ID) {
    return {
      points: indicative.points,
      waypoints: [],
      controls: PBP_2027_CONTROLS.map((c, i) => ({ ...c, km: indicative.controlKms[i], offsetKm: 0 })),
    };
  }
  const route = await prisma.pbpRoute.findUnique({ where: { id } });
  if (!route) return null;
  const points = (JSON.parse(route.points) as CompactPoint[]).map(fromCompact);
  return { points, waypoints: JSON.parse(route.waypoints) as GpxWaypoint[], controls: projectControls(points) };
}

export async function pbpRoutesRoutes(app: FastifyInstance) {
  app.get("/pbp/meta", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send({
      controls: PBP_2027_CONTROLS,
      waves: PBP_2027_WAVES,
      totalKm: PBP_2027_TOTAL_KM,
      weatherConfigured: Boolean(config.openWeatherApiKey),
    });
  });

  app.get("/pbp/routes", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const routes = await prisma.pbpRoute.findMany({ orderBy: { createdAt: "desc" }, select: META_SELECT });
    return reply.send({
      routes: [...routes.map((r) => serializeMeta(r, user.id, user.isAdmin)), INDICATIVE_META],
      defaultId: pickDefaultRouteId(routes),
    });
  });

  app.get("/pbp/routes/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };

    const loaded = await loadRoutePoints(id);
    if (!loaded) return reply.code(404).send({ error: "not_found" });

    const waypoints = loaded.waypoints.map((w) => {
      const { km, distanceM } = projectOntoRoute(loaded.points, w);
      return { ...w, km: Math.round(km * 10) / 10, offsetKm: Math.round(distanceM / 100) / 10 };
    });

    return reply.send({
      points: loaded.points.map(toCompact),
      waypoints,
      controls: loaded.controls,
    });
  });

  app.post("/pbp/routes", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const file = await request.file({ limits: { fileSize: MAX_GPX_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!/\.gpx$/i.test(file.filename)) return reply.code(400).send({ error: "invalid_file_type" });

    // Champs envoyés AVANT le fichier dans le multipart (voir web/src/api/pbpRoutes.ts) :
    // @fastify/multipart ne connaît que ceux-là au moment où on lit le fichier.
    const field = (name: string) => {
      const v = (file.fields?.[name] as { value?: unknown } | undefined)?.value;
      return typeof v === "string" ? v.trim() : "";
    };
    const requestedKind = field("kind") as RouteKind;
    // Seul un admin peut publier un tracé "officiel"/"provisoire" : sinon n'importe
    // qui pourrait faire basculer tout le monde sur son tracé.
    const kind: RouteKind = user.isAdmin && ROUTE_KINDS.includes(requestedKind) ? requestedKind : "communautaire";
    const label = field("label").slice(0, 100) || file.filename.replace(/\.gpx$/i, "");
    const description = field("description").slice(0, 500) || null;

    const buffer = await file.toBuffer();
    if (file.file.truncated || buffer.length > MAX_GPX_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const parsed = parseGpxRoute(buffer.toString("utf8"));
    if (!parsed) return reply.code(422).send({ error: "unreadable_gpx" });

    const filePath = await saveUploadedFile("pbp-routes", buffer);
    const route = await prisma.pbpRoute.create({
      data: {
        label,
        kind,
        description,
        fileName: file.filename,
        filePath,
        points: JSON.stringify(parsed.points.map(toCompact)),
        waypoints: JSON.stringify(parsed.waypoints),
        distanceKm: parsed.stats.distanceKm,
        elevationGainM: parsed.stats.elevationGainM,
        elevationLossM: parsed.stats.elevationLossM,
        rawPointCount: parsed.rawPointCount,
        uploadedByUserId: user.id,
      },
      select: META_SELECT,
    });

    return reply.code(201).send({ route: serializeMeta(route, user.id, user.isAdmin), simplifiedPointCount: parsed.points.length });
  });

  app.patch("/pbp/routes/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!user.isAdmin) return reply.code(403).send({ error: "forbidden" });

    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const existing = await prisma.pbpRoute.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const route = await prisma.pbpRoute.update({
      where: { id },
      data: parsed.data,
      select: META_SELECT,
    });
    return reply.send({ route: serializeMeta(route, user.id, user.isAdmin) });
  });

  app.delete("/pbp/routes/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.pbpRoute.findUnique({ where: { id }, select: { uploadedByUserId: true, filePath: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!user.isAdmin && existing.uploadedByUserId !== user.id) return reply.code(403).send({ error: "forbidden" });

    await prisma.pbpRoute.delete({ where: { id } });
    await deleteUploadedFile(existing.filePath).catch(() => undefined);
    return reply.code(204).send();
  });

  app.get("/pbp/routes/:id/gpx", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const route = await prisma.pbpRoute.findUnique({ where: { id }, select: { fileName: true, filePath: true } });
    if (!route) return reply.code(404).send({ error: "not_found" });

    const content = await readUploadedFile(route.filePath);
    reply.header("content-type", "application/gpx+xml");
    reply.header("content-disposition", `attachment; filename="${route.fileName.replace(/"/g, "")}"`);
    return reply.send(content);
  });

  app.get("/pbp/routes/:id/weather", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!config.openWeatherApiKey) return reply.code(503).send({ error: "not_configured" });

    const parsed = weatherQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const { id } = request.params as { id: string };
    const loaded = await loadRoutePoints(id);
    if (!loaded) return reply.code(404).send({ error: "not_found" });

    const controls = loaded.controls.filter((c): c is ProjectedControl & { km: number } => c.km !== null).map((c) => ({ km: c.km, name: c.name }));
    const result = await computeRouteWeather({
      points: loaded.points,
      controls,
      start: new Date(parsed.data.start),
      speedKmh: parsed.data.speed,
      stepKm: parsed.data.step,
    });
    return reply.send(result);
  });

  // Météo "là où je suis" (bouton de géolocalisation sur la page) : les prochaines
  // 24h au point donné, sans lien avec un tracé.
  app.get("/pbp/weather/point", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!config.openWeatherApiKey) return reply.code(503).send({ error: "not_configured" });

    const parsed = pointQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const fc = await fetchForecastAt(parsed.data.lat, parsed.data.lon);
    if (!fc) return reply.code(502).send({ error: "meteo_unavailable" });
    return reply.send({ place: fc.place, slots: fc.slots.slice(0, 8) });
  });
}
