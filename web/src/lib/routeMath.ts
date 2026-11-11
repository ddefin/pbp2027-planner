import type { TrackPoint } from "../api/brmCatalog";

// Distance approximative en mètres (équirectangulaire) : suffisant pour trouver le
// point le plus proche, beaucoup plus rapide que haversine sur des milliers de points.
function approxDist2(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = b.lat - a.lat;
  return x * x + y * y;
}

export function nearestIndex(points: { lat: number; lon: number }[], target: { lat: number; lon: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = approxDist2(points[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Distance (km) entre un point et sa projection la plus proche sur le tracé —
// pour dire "tu es à 3 km du parcours" quand on se géolocalise.
export function distanceToRouteKm(points: TrackPoint[], target: { lat: number; lon: number }): { km: number; offsetKm: number } {
  const i = nearestIndex(points, target);
  const p = points[i];
  const dLat = ((target.lat - p.lat) * Math.PI) / 180;
  const dLon = ((target.lon - p.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((p.lat * Math.PI) / 180) * Math.cos((target.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return { km: p.distKm, offsetKm: 2 * 6371 * Math.asin(Math.sqrt(h)) };
}

// Interpolation au km donné (recherche dichotomique : appelée à chaque mouvement du
// curseur, doit rester instantanée même sur 4000 points).
export function pointAtKm(points: TrackPoint[], km: number): TrackPoint {
  if (km <= points[0].distKm) return points[0];
  const last = points[points.length - 1];
  if (km >= last.distKm) return last;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distKm <= km) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = b.distKm > a.distKm ? (km - a.distKm) / (b.distKm - a.distKm) : 0;
  const ele = a.ele !== null && b.ele !== null ? a.ele + t * (b.ele - a.ele) : a.ele;
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon), ele, distKm: km };
}

// D+ / D- entre deux km (même seuil de bruit de 2 m que le reste de l'app).
export function elevationBetween(points: TrackPoint[], fromKm: number, toKm: number): { gain: number; loss: number } | null {
  let gain = 0;
  let loss = 0;
  let last: number | null = null;
  let any = false;
  for (const p of points) {
    if (p.distKm < fromKm || p.distKm > toKm || p.ele === null) continue;
    any = true;
    if (last === null) {
      last = p.ele;
      continue;
    }
    const d = p.ele - last;
    if (d >= 2) {
      gain += d;
      last = p.ele;
    } else if (d <= -2) {
      loss -= d;
      last = p.ele;
    }
  }
  return any ? { gain: Math.round(gain), loss: Math.round(loss) } : null;
}

export function etaAt(startIso: string, speedKmh: number, km: number): Date {
  return new Date(new Date(startIso).getTime() + (km / speedKmh) * 3600_000);
}

export function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `${h + 1}h00` : `${h}h${String(m).padStart(2, "0")}`;
}

export function formatEta(d: Date): string {
  return d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
