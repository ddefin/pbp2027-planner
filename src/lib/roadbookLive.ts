import { prisma } from "../db.js";
import { gatherSituation, toSituationInput } from "./roadbookSituation.js";

// Vue « en direct » pour la page de suivi publique : mêmes calculs que le résumé du
// canal (heure d'arrivée, barrière, météo devant), en JSON structuré. La météo vient
// d'un service externe à quota : le résultat est gardé 10 min par roadbook.

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { checkinId: string; at: number; value: LiveView }>();

export interface LiveWeather {
  label: string;
  km: number;
  at: string;
  tempC: number;
  feelsLikeC: number;
  description: string;
  icon: string;
  windSpeedKmh: number;
  relation: "dos" | "face" | "travers" | null;
  rainProbability: number;
  alerts: string[];
}

export interface LiveView {
  checkinAt: string;
  km: number;
  kmLeft: number;
  totalKm: number;
  place: string | null;
  finished: boolean;
  plannedFinishAt: string | null;
  paceFinishAt: string | null;
  limitAt: string | null;
  planDeltaMin: number | null;
  barrierMarginMin: number | null;
  barrierLevel: "ok" | "tight" | "late" | null;
  nextControl: { name: string; km: number; eta: string | null; closeAt: string | null } | null;
  weather: LiveWeather[];
}

export async function liveView(roadbookId: string): Promise<LiveView | null> {
  const last = await prisma.roadbookCheckin.findFirst({ where: { roadbookId }, orderBy: { at: "desc" } });
  if (!last) return null;
  const hit = cache.get(roadbookId);
  if (hit && hit.checkinId === last.id && Date.now() - hit.at < TTL_MS) return hit.value;

  const r = await prisma.roadbook.findUnique({ where: { id: roadbookId } });
  if (!r) return null;
  const s = await gatherSituation(toSituationInput(r), last.km, last.at, last.lat !== null && last.lon !== null ? { lat: last.lat, lon: last.lon } : null);
  const nc = s.nextControl;
  const value: LiveView = {
    checkinAt: last.at.toISOString(),
    km: s.km,
    kmLeft: s.kmLeft,
    totalKm: s.totalKm,
    place: s.place,
    finished: s.kmLeft === 0,
    plannedFinishAt: s.kmLeft > 0 ? s.plannedFinishAt?.toISOString() ?? null : null,
    paceFinishAt: s.paceFinishAt?.toISOString() ?? null,
    limitAt: s.limitAt?.toISOString() ?? null,
    planDeltaMin: s.status?.planDeltaMin ?? null,
    barrierMarginMin: s.status?.barrierMarginMin ?? null,
    barrierLevel: s.status ? (s.status.closedAlready ? "late" : s.status.barrierLevel) : null,
    nextControl: nc
      ? { name: nc.name, km: nc.km, eta: s.nextControlEta?.toISOString() ?? null, closeAt: s.startAt ? new Date(s.startAt.getTime() + nc.closeMin * 60_000).toISOString() : null }
      : null,
    weather: s.weather.map((w) => ({
      label: w.label,
      km: w.km,
      at: w.at.toISOString(),
      tempC: w.slot.tempC,
      feelsLikeC: w.slot.feelsLikeC,
      description: w.slot.description,
      icon: w.slot.icon,
      windSpeedKmh: w.slot.windSpeedKmh,
      relation: w.relation,
      rainProbability: w.slot.precipitationProbability,
      alerts: w.alerts,
    })),
  };
  cache.set(roadbookId, { checkinId: last.id, at: Date.now(), value });
  return value;
}
