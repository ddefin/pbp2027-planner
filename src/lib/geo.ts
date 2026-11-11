export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface RoutePoint extends GeoPoint {
  ele: number | null;
  distKm: number; // cumulé depuis le départ, calculé sur le tracé PLEINE résolution
}

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Cap (0-360°, 0 = nord) de a vers b.
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Douglas-Peucker en 3D (x/y en mètres sur une projection équirectangulaire locale,
// z = altitude en mètres) : un DP purement planaire écraserait une bosse sur une
// route rectiligne (deux points aux extrémités, plus rien entre), ce qui fausserait
// le profil et le D+ affichés. Itératif (pile explicite) plutôt que récursif : un
// GPX de 1200 km dépasse facilement 50 000 points, de quoi faire déborder la pile
// d'appels en récursif sur un tracé quasi rectiligne.
export function douglasPeucker3D(points: RoutePoint[], toleranceM: number): RoutePoint[] {
  const n = points.length;
  if (n <= 2) return points.slice();

  const lat0 = toRad(points.reduce((s, p) => s + p.lat, 0) / n);
  const cosLat0 = Math.cos(lat0);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = toRad(points[i].lon) * cosLat0 * EARTH_RADIUS_M;
    ys[i] = toRad(points[i].lat) * EARTH_RADIUS_M;
    zs[i] = points[i].ele ?? 0;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    const ax = xs[start], ay = ys[start], az = zs[start];
    const dx = xs[end] - ax, dy = ys[end] - ay, dz = zs[end] - az;
    const segLen2 = dx * dx + dy * dy + dz * dz;

    let maxD2 = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const px = xs[i] - ax, py = ys[i] - ay, pz = zs[i] - az;
      let d2: number;
      if (segLen2 === 0) {
        d2 = px * px + py * py + pz * pz;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / segLen2));
        const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz;
        d2 = ex * ex + ey * ey + ez * ez;
      }
      if (d2 > maxD2) {
        maxD2 = d2;
        maxIdx = i;
      }
    }

    if (maxD2 > tol2) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Tolérance adaptative : on part fin (fidèle au tracé) et on relâche jusqu'à tenir
// sous maxPoints — un 200 km garde presque tout, un 1200 km sinueux est allégé
// juste ce qu'il faut pour rester fluide sur mobile.
export function simplifyRoute(points: RoutePoint[], maxPoints: number, initialToleranceM = 5): RoutePoint[] {
  let tolerance = initialToleranceM;
  let result = douglasPeucker3D(points, tolerance);
  while (result.length > maxPoints && tolerance < 5000) {
    tolerance *= 1.5;
    result = douglasPeucker3D(points, tolerance);
  }
  return result;
}

// Index du point du tracé le plus proche (recherche linéaire : quelques milliers de
// points après simplification, négligeable par rapport à un appel réseau).
export function nearestPointIndex(points: GeoPoint[], target: GeoPoint): { index: number; distanceM: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversineMeters(points[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distanceM: bestD };
}

// Position interpolée au kilomètre donné (points triés par distKm croissante).
export function pointAtKm(points: RoutePoint[], km: number): RoutePoint {
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
  const span = b.distKm - a.distKm;
  const t = span > 0 ? (km - a.distKm) / span : 0;
  const ele = a.ele !== null && b.ele !== null ? a.ele + t * (b.ele - a.ele) : (a.ele ?? b.ele);
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon), ele, distKm: km };
}

// Cap local du parcours autour d'un kilomètre (sur ±windowKm) : plus représentatif
// du sens de la route à cet endroit que le cap entre deux points simplifiés voisins,
// qui peut être très court et donc bruité.
export function routeBearingAt(points: RoutePoint[], km: number, windowKm = 3): number {
  const total = points[points.length - 1].distKm;
  const a = pointAtKm(points, Math.max(0, km - windowKm));
  const b = pointAtKm(points, Math.min(total, km + windowKm));
  return bearingDeg(a, b);
}

// Format compact pour le transfert et le stockage (≈ 30 octets/point au lieu de ~70
// en objets JSON nommés) : 4000 points restent sous les 150 Ko, important sur un
// réseau mobile faible en bord de route. Précision 1e-5° ≈ 1 m, largement suffisant.
export type CompactPoint = [number, number, number | null, number];

export function toCompactPoint(p: RoutePoint): CompactPoint {
  return [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, p.ele === null ? null : Math.round(p.ele), Math.round(p.distKm * 100) / 100];
}

export function fromCompactPoint(c: CompactPoint): RoutePoint {
  return { lat: c[0], lon: c[1], ele: c[2], distKm: c[3] };
}
