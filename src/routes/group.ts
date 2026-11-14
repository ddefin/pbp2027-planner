import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { avatarOf } from "../lib/avatar.js";
import { pointAtKm } from "../lib/geo.js";
import { computeSituation, toSituationInput } from "../lib/roadbookSituation.js";

const HOUR = 3_600_000;
const BEFORE_MS = 12 * HOUR; // visible 12 h avant le départ…
const AFTER_MS = 6 * HOUR; // …jusqu'à 6 h après le délai du brevet
const TRACK_POINTS = 250;

// Carte du groupe le jour J : le DERNIER POINTAGE des randonneurs qui l'ont accepté
// (case « Visible du groupe » de leur roadbook), pendant leur brevet. Aucun suivi GPS
// continu : seulement les pointages volontaires. Réservé aux membres connectés.
export async function groupRoutes(app: FastifyInstance) {
  app.get("/group/live", async (request, reply) => {
    const viewer = await getSessionUser(request);
    if (!viewer) return reply.code(401).send({ error: "unauthenticated" });
    const now = new Date();

    const rows = await prisma.roadbook.findMany({
      where: { groupShare: true, startAt: { not: null }, user: { suspendedAt: null, isSystem: false } },
      include: { user: { select: { id: true, prenom: true, avatar: true, avatarKey: true } }, checkins: { orderBy: { at: "desc" }, take: 1 } },
    });

    const riders = [];
    for (const r of rows) {
      const start = r.startAt!.getTime();
      if (now.getTime() < start - BEFORE_MS || now.getTime() > start + r.limitMinutes * 60_000 + AFTER_MS) continue;
      const input = toSituationInput(r);
      const totalKm = input.points[input.points.length - 1].distKm;
      // Un pointage antérieur à la fenêtre (essai fait la semaine d'avant) ne compte pas.
      const last = r.checkins[0] && r.checkins[0].at.getTime() >= start - BEFORE_MS ? r.checkins[0] : null;
      const km = last?.km ?? 0;
      const pos = last && last.lat !== null && last.lon !== null ? { lat: last.lat, lon: last.lon } : pointAtKm(input.points, km);
      const s = last ? computeSituation(input, km, last.at, now) : null;
      const step = Math.max(1, Math.ceil(input.points.length / TRACK_POINTS));
      riders.push({
        id: r.id,
        prenom: r.user.prenom,
        avatar: avatarOf(r.user),
        mine: r.user.id === viewer.id,
        title: r.title,
        startAt: r.startAt!.toISOString(),
        totalKm: Math.round(totalKm * 10) / 10,
        km: Math.round(km * 10) / 10,
        lat: pos.lat,
        lon: pos.lon,
        checkinAt: last?.at.toISOString() ?? null,
        finished: km >= totalKm - 0.5,
        level: s?.status ? (s.status.closedAlready ? "late" : s.status.barrierLevel) : null,
        nextControl: s?.nextControl?.name ?? null,
        track: input.points.filter((_, i) => i % step === 0 || i === input.points.length - 1).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]),
      });
    }
    riders.sort((a, b) => b.km - a.km);
    reply.header("cache-control", "no-store");
    return reply.send({ riders, at: now.toISOString() });
  });
}
