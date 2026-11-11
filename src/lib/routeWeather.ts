import { config } from "../config.js";
import { pointAtKm, routeBearingAt, type RoutePoint } from "./geo.js";
import { fetchForecastAt, type PointForecastSlot } from "./openWeather.js";

export type WindRelation = "dos" | "face" | "travers";
export type WeatherAlert = "vent_fort" | "vent_de_face" | "pluie" | "froid" | "chaleur";

export interface RouteWeatherSample {
  km: number;
  lat: number;
  lon: number;
  label: string; // nom du contrôle, sinon localité OpenWeatherMap la plus proche
  isControl: boolean;
  eta: string; // heure de passage estimée (ISO)
  routeBearingDeg: number;
  forecast: (PointForecastSlot & { windRelation: WindRelation | null; alongWindKmh: number | null }) | null;
  outOfRange: boolean; // passage hors de l'horizon de prévision (> ~5 jours)
  alerts: WeatherAlert[];
}

export interface RouteWeatherResult {
  samples: RouteWeatherSample[];
  horizonEnd: string | null; // dernière échéance de prévision disponible
  configured: boolean;
}

// Seuils pensés pour le vélo d'endurance, pas pour la sécurité civile : un vent de
// face de 20 km/h coûte cher sur 100 km sans être une "alerte" météo officielle.
const HEADWIND_ALERT_KMH = 20;
const GUSTS_ALERT_KMH = 65;
const RAIN_PROBABILITY_ALERT = 0.6;
const RAIN_MM_ALERT = 2;
const COLD_FEELS_LIKE_C = 5;
const HOT_FEELS_LIKE_C = 30;

const MAX_SAMPLES = 40;
const CONTROL_DEDUP_KM = 15;
const SLOT_HALF_WIDTH_MS = 1.5 * 60 * 60 * 1000; // créneaux de 3h de l'API gratuite
const FETCH_CONCURRENCY = 5;

// windFromDeg : d'où vient le vent. Composante le long de la route positive = vent
// qui pousse (dos), négative = vent qui freine (face).
export function windAlongRoute(windFromDeg: number, windKmh: number, routeBearing: number): { relation: WindRelation; alongKmh: number } {
  const windTo = (windFromDeg + 180) % 360;
  const diff = Math.abs(((windTo - routeBearing + 540) % 360) - 180);
  const alongKmh = Math.round(windKmh * Math.cos((diff * Math.PI) / 180));
  const relation: WindRelation = diff <= 45 ? "dos" : diff >= 135 ? "face" : "travers";
  return { relation, alongKmh };
}

export function alertsFor(slot: PointForecastSlot, alongKmh: number | null): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  if (slot.windSpeedKmh >= config.windAlertThresholdKmh || (slot.windGustsKmh ?? 0) >= GUSTS_ALERT_KMH) alerts.push("vent_fort");
  if (alongKmh !== null && -alongKmh >= HEADWIND_ALERT_KMH) alerts.push("vent_de_face");
  if (slot.precipitationProbability >= RAIN_PROBABILITY_ALERT || slot.rainMm >= RAIN_MM_ALERT) alerts.push("pluie");
  if (slot.feelsLikeC <= COLD_FEELS_LIKE_C) alerts.push("froid");
  if (slot.feelsLikeC >= HOT_FEELS_LIKE_C) alerts.push("chaleur");
  return alerts;
}

// Kilomètres échantillonnés : chaque contrôle (là où on s'arrête — c'est là que la
// météo compte le plus pour décider d'une couche de plus ou d'une sieste), plus un
// point tous les stepKm entre deux, sans doublon à proximité immédiate d'un contrôle.
export function sampleKms(totalKm: number, controls: { km: number; name: string }[], stepKm: number): { km: number; control: string | null }[] {
  const list: { km: number; control: string | null }[] = controls.map((c) => ({ km: c.km, control: c.name }));
  for (let km = stepKm; km < totalKm; km += stepKm) {
    if (!controls.some((c) => Math.abs(c.km - km) < CONTROL_DEDUP_KM)) list.push({ km, control: null });
  }
  if (!list.some((s) => s.km === 0)) list.push({ km: 0, control: null });
  list.sort((a, b) => a.km - b.km);
  if (list.length <= MAX_SAMPLES) return list;
  // Trop d'échantillons (pas trop fin) : on garde tous les contrôles, on espace le reste.
  const ctrl = list.filter((s) => s.control);
  const others = list.filter((s) => !s.control);
  const keepEvery = Math.ceil(others.length / Math.max(1, MAX_SAMPLES - ctrl.length));
  return [...ctrl, ...others.filter((_, i) => i % keepEvery === 0)].sort((a, b) => a.km - b.km);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function computeRouteWeather(params: {
  points: RoutePoint[];
  controls: { km: number; name: string }[];
  start: Date;
  speedKmh: number;
  stepKm: number;
}): Promise<RouteWeatherResult> {
  const { points, controls, start, speedKmh, stepKm } = params;
  if (!config.openWeatherApiKey) return { samples: [], horizonEnd: null, configured: false };

  const totalKm = points[points.length - 1].distKm;
  const kms = sampleKms(totalKm, controls, stepKm);
  let horizonEnd: string | null = null;

  const samples = await mapWithConcurrency(kms, FETCH_CONCURRENCY, async ({ km, control }): Promise<RouteWeatherSample> => {
    const p = pointAtKm(points, km);
    const etaMs = start.getTime() + (km / speedKmh) * 60 * 60 * 1000;
    const bearing = Math.round(routeBearingAt(points, km));
    const fc = await fetchForecastAt(p.lat, p.lon);

    const base = {
      km: Math.round(km * 10) / 10,
      lat: p.lat,
      lon: p.lon,
      label: control ?? fc?.place ?? `km ${Math.round(km)}`,
      isControl: control !== null,
      eta: new Date(etaMs).toISOString(),
      routeBearingDeg: bearing,
    };
    if (!fc || fc.slots.length === 0) return { ...base, forecast: null, outOfRange: false, alerts: [] };

    const last = fc.slots[fc.slots.length - 1].at;
    if (!horizonEnd || last > horizonEnd) horizonEnd = last;

    let best: PointForecastSlot | null = null;
    let bestDiff = Infinity;
    for (const s of fc.slots) {
      const diff = Math.abs(new Date(s.at).getTime() - etaMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    if (!best || bestDiff > SLOT_HALF_WIDTH_MS) return { ...base, forecast: null, outOfRange: true, alerts: [] };

    const wind = best.windFromDeg !== null ? windAlongRoute(best.windFromDeg, best.windSpeedKmh, bearing) : null;
    return {
      ...base,
      forecast: { ...best, windRelation: wind?.relation ?? null, alongWindKmh: wind?.alongKmh ?? null },
      outOfRange: false,
      alerts: alertsFor(best, wind?.alongKmh ?? null),
    };
  });

  return { samples, horizonEnd, configured: true };
}
