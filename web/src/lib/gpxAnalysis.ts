import type { TrackPoint } from "../api/brmCatalog";

// Cap (0-360°, 0 = nord) du point a vers le point b.
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// Cap général du parcours : départ -> arrivée, pas la moyenne de chaque segment (qui
// se compenserait sur un circuit en boucle). Un BRM part et revient souvent au même
// point, donc c'est une approximation utile pour "vent de face/dos" mais pas une
// vérité absolue sur tout le trajet — assumé et dit à l'utilisateur dans l'UI.
export function overallBearing(points: TrackPoint[]): number | null {
  if (points.length < 2) return null;
  return bearing(points[0], points[points.length - 1]);
}

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

// Inverse de src/lib/openWeather.ts#degToCompass (backend) : la météo ne renvoie que
// le libellé ("NO", "SE"...), pas le degré brut — on retrouve le degré du centre du
// secteur, suffisant pour classer face/dos/travers (buckets de 45°).
export function compassToDeg(label: string): number | null {
  const idx = COMPASS_16.indexOf(label);
  return idx === -1 ? null : idx * 22.5;
}

export type WindRelation = "dos" | "face" | "travers";

// windFromDeg : direction d'où vient le vent (convention météo, ex. OpenWeatherMap
// wind.deg) — donc la direction vers laquelle il souffle est windFromDeg + 180.
export function windRelation(windFromDeg: number, routeBearingDeg: number): WindRelation {
  const windToDeg = (windFromDeg + 180) % 360;
  const diff = Math.abs(((windToDeg - routeBearingDeg + 540) % 360) - 180); // écart 0-180°
  if (diff <= 45) return "dos";
  if (diff >= 135) return "face";
  return "travers";
}

export const WIND_RELATION_LABEL: Record<WindRelation, string> = {
  dos: "Vent de dos (favorable)",
  face: "Vent de face (défavorable)",
  travers: "Vent de travers",
};

export interface Climb {
  startKm: number;
  endKm: number;
  lengthKm: number;
  gainM: number;
  avgGrade: number; // %
  maxGrade: number; // % sur une fenêtre locale à l'intérieur de la montée
}

// Détecte les montées significatives : segments où la pente lissée reste au-dessus
// de MIN_GRADE sur au moins MIN_LENGTH_KM, en tolérant de courts replats/descentes
// (GAP_TOLERANCE_KM) pour ne pas fragmenter une même ascension en dix petits
// morceaux à cause du bruit GPS/altimétrique.
const MIN_GRADE = 2.5;
const MIN_LENGTH_KM = 0.8;
const GAP_TOLERANCE_KM = 0.3;

export function findClimbs(points: TrackPoint[]): Climb[] {
  const withEle = points.filter((p) => p.ele !== null);
  if (withEle.length < 2) return [];

  // Pente instantanée (lissée sur le pas d'échantillonnage réel, déjà assez espacé
  // après décimation côté serveur) entre points consécutifs.
  const grades: number[] = [0];
  for (let i = 1; i < withEle.length; i++) {
    const dKm = withEle[i].distKm - withEle[i - 1].distKm;
    const dEle = (withEle[i].ele as number) - (withEle[i - 1].ele as number);
    grades.push(dKm > 0 ? (dEle / 1000 / dKm) * 100 : 0);
  }

  const climbs: Climb[] = [];
  let i = 1;
  while (i < withEle.length) {
    if (grades[i] < MIN_GRADE) {
      i++;
      continue;
    }
    let j = i;
    let lastAboveThreshold = i;
    while (j < withEle.length - 1) {
      j++;
      if (grades[j] >= MIN_GRADE) {
        lastAboveThreshold = j;
      } else if (withEle[j].distKm - withEle[lastAboveThreshold].distKm > GAP_TOLERANCE_KM) {
        break;
      }
    }
    const startIdx = i - 1;
    const endIdx = lastAboveThreshold;
    const lengthKm = withEle[endIdx].distKm - withEle[startIdx].distKm;
    if (lengthKm >= MIN_LENGTH_KM) {
      const gainM = Math.max(0, (withEle[endIdx].ele as number) - (withEle[startIdx].ele as number));
      climbs.push({
        startKm: withEle[startIdx].distKm,
        endKm: withEle[endIdx].distKm,
        lengthKm: Math.round(lengthKm * 10) / 10,
        gainM: Math.round(gainM),
        avgGrade: Math.round((gainM / 1000 / lengthKm) * 1000) / 10,
        maxGrade: Math.round(Math.max(...grades.slice(startIdx + 1, endIdx + 1)) * 10) / 10,
      });
    }
    i = j + 1;
  }
  return climbs;
}

// Dénivelé positif cumulé à chaque échantillon, avec le même seuil de bruit que les
// statistiques globales (voir src/lib/gpx.ts côté serveur) — pour l'affichage au
// survol du profil ("D+ cumulé à ce point").
const ELEVATION_NOISE_THRESHOLD_M = 2;

export function cumulativeGain(points: TrackPoint[]): number[] {
  const result: number[] = [];
  let gain = 0;
  let lastEle: number | null = null;
  for (const p of points) {
    if (p.ele !== null) {
      if (lastEle !== null) {
        const delta = p.ele - lastEle;
        if (delta >= ELEVATION_NOISE_THRESHOLD_M) {
          gain += delta;
          lastEle = p.ele;
        } else if (delta <= -ELEVATION_NOISE_THRESHOLD_M) {
          lastEle = p.ele;
        }
      } else {
        lastEle = p.ele;
      }
    }
    result.push(Math.round(gain));
  }
  return result;
}
