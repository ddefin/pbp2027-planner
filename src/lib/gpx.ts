import { XMLParser } from "fast-xml-parser";

export interface GpxStats {
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
}

interface TrackPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

const EARTH_RADIUS_M = 6371000;

function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Ignore les variations d'altitude sous ce seuil avant de les cumuler en D+/D- :
// le bruit du capteur GPS/baro ferait sinon exploser le dénivelé calculé.
const ELEVATION_NOISE_THRESHOLD_M = 2;

function collectPoints(parsed: unknown): TrackPoint[] {
  const points: TrackPoint[] = [];
  const gpx = (parsed as Record<string, unknown>)?.gpx as Record<string, unknown> | undefined;
  if (!gpx) return points;

  const tracks = ([] as unknown[]).concat((gpx.trk as unknown) ?? []);
  for (const trk of tracks) {
    const segments = ([] as unknown[]).concat(((trk as Record<string, unknown>)?.trkseg as unknown) ?? []);
    for (const seg of segments) {
      const trkpts = ([] as unknown[]).concat(((seg as Record<string, unknown>)?.trkpt as unknown) ?? []);
      for (const pt of trkpts) {
        const p = pt as Record<string, unknown>;
        const lat = Number(p["@_lat"]);
        const lon = Number(p["@_lon"]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const ele = p.ele !== undefined ? Number(p.ele) : null;
        points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
      }
    }
  }

  // Pas de <trk>, mais un <rte> (itinéraire plutôt que trace enregistrée) : on l'accepte aussi.
  if (points.length === 0 && gpx.rte) {
    const routes = ([] as unknown[]).concat(gpx.rte as unknown);
    for (const rte of routes) {
      const rtepts = ([] as unknown[]).concat(((rte as Record<string, unknown>)?.rtept as unknown) ?? []);
      for (const pt of rtepts) {
        const p = pt as Record<string, unknown>;
        const lat = Number(p["@_lat"]);
        const lon = Number(p["@_lon"]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const ele = p.ele !== undefined ? Number(p.ele) : null;
        points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
      }
    }
  }

  return points;
}

// Certains GPX n'ont pas d'altitude sur leurs tout premiers (ou derniers) points
// (le capteur baro/GPS n'a parfois pas encore de valeur fiable au tout début de
// l'enregistrement) — sans ça, le profil perdait ce morceau du tracé au lieu de
// juste réutiliser la valeur connue la plus proche.
function fillMissingElevation(points: TrackPoint[]): TrackPoint[] {
  const filled = points.map((p) => ({ ...p }));
  let lastKnown: number | null = null;
  for (const p of filled) {
    if (p.ele !== null) lastKnown = p.ele;
    else if (lastKnown !== null) p.ele = lastKnown;
  }
  let nextKnown: number | null = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (filled[i].ele !== null) nextKnown = filled[i].ele;
    else if (nextKnown !== null) filled[i].ele = nextKnown;
  }
  return filled;
}

export interface TrackProfilePoint {
  lat: number;
  lon: number;
  ele: number | null;
  distKm: number; // cumulé depuis le départ
}

// Tracé décimé pour l'affichage carte + profil (Leaflet + graphique dénivelé) : un
// GPX de 1200km peut contenir des dizaines de milliers de points, bien plus que
// nécessaire pour un rendu lisible. Décimation par distance plutôt que par index :
// des points espacés régulièrement en km (plutôt qu'un point sur N, qui donnerait
// des échantillons plus denses là où le GPS a enregistré plus souvent) — important
// ici puisque distKm sert ensuite d'axe à un graphique et à placer des repères
// kilométriques. Toujours le premier et le dernier point, pour ne pas raccourcir le
// tracé.
export function parseGpxProfile(xml: string, maxPoints = 600): TrackProfilePoint[] | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return null;
  }

  const rawPoints = collectPoints(parsed);
  if (rawPoints.length < 2) return null;
  const points = fillMissingElevation(rawPoints);

  const cumKm: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumKm.push(cumKm[i - 1] + haversineMeters(points[i - 1], points[i]) / 1000);
  }
  const totalKm = cumKm[cumKm.length - 1];

  if (points.length <= maxPoints) {
    return points.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: p.ele, distKm: Math.round(cumKm[i] * 100) / 100 }));
  }

  const stepKm = totalKm / (maxPoints - 1);
  const decimated: TrackProfilePoint[] = [];
  let nextIdx = 0;
  for (let k = 0; k < maxPoints; k++) {
    const targetKm = k * stepKm;
    while (nextIdx < points.length - 1 && cumKm[nextIdx] < targetKm) nextIdx++;
    const p = points[nextIdx];
    decimated.push({ lat: p.lat, lon: p.lon, ele: p.ele, distKm: Math.round(cumKm[nextIdx] * 100) / 100 });
  }
  // Le dernier échantillon doit être le vrai point final (pas une approximation).
  const last = points[points.length - 1];
  decimated[decimated.length - 1] = { lat: last.lat, lon: last.lon, ele: last.ele, distKm: Math.round(totalKm * 100) / 100 };
  return decimated;
}

export function parseGpxStats(xml: string): GpxStats | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return null;
  }

  const points = collectPoints(parsed);
  if (points.length < 2) return null;

  let distanceM = 0;
  let gainM = 0;
  let lossM = 0;
  let minEle: number | null = null;
  let maxEle: number | null = null;
  let lastEle: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.ele !== null) {
      minEle = minEle === null ? p.ele : Math.min(minEle, p.ele);
      maxEle = maxEle === null ? p.ele : Math.max(maxEle, p.ele);
      if (lastEle !== null) {
        const delta = p.ele - lastEle;
        if (Math.abs(delta) >= ELEVATION_NOISE_THRESHOLD_M) {
          if (delta > 0) gainM += delta;
          else lossM += -delta;
          lastEle = p.ele;
        }
      } else {
        lastEle = p.ele;
      }
    }
    if (i > 0) distanceM += haversineMeters(points[i - 1], p);
  }

  return {
    distanceKm: Math.round((distanceM / 1000) * 10) / 10,
    elevationGainM: minEle !== null ? Math.round(gainM) : null,
    elevationLossM: minEle !== null ? Math.round(lossM) : null,
    minAltitudeM: minEle !== null ? Math.round(minEle) : null,
    maxAltitudeM: maxEle !== null ? Math.round(maxEle) : null,
  };
}
