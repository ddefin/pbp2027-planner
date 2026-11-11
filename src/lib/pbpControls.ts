import { haversineMeters, projectOntoRoute, type RoutePoint } from "./geo.js";

// Données publiées sur https://www.paris-brest-paris.org/parcours/ (novembre 2026) :
// la liste des étapes est connue, pas encore le tracé détaillé. Coordonnées = centre
// de chaque ville (l'emplacement exact des contrôles n'est pas encore publié) — assez
// précis pour la météo et pour repérer le passage sur un tracé, pas pour s'y rendre.
// À mettre à jour ici (et seulement ici) si l'organisation modifie la liste.
export type ControlService = "controle" | "restauration" | "douches" | "couchage" | "mecanique";

export interface PbpControl {
  step: number; // 0 = départ
  name: string;
  lat: number;
  lon: number;
  officialKm: number | null; // renseigné seulement quand l'organisation l'a publié
  services: ControlService[];
  note?: string;
}

const ALL: ControlService[] = ["controle", "restauration", "douches", "couchage", "mecanique"];
const NO_MECA: ControlService[] = ["controle", "restauration", "douches", "couchage"];

export const PBP_2027_CONTROLS: PbpControl[] = [
  { step: 0, name: "Rambouillet (départ)", lat: 48.6436, lon: 1.8295, officialKm: 0, services: [] },
  { step: 1, name: "Mortagne-au-Perche", lat: 48.5203, lon: 0.5472, officialKm: 119, services: ["restauration", "mecanique"], note: "Accueil, pas de contrôle à l'aller" },
  { step: 2, name: "Villaines-la-Juhel", lat: 48.3433, lon: -0.2786, officialKm: null, services: ALL },
  { step: 3, name: "Fougères", lat: 48.3525, lon: -1.1986, officialKm: null, services: NO_MECA },
  { step: 4, name: "Tinténiac", lat: 48.3283, lon: -1.8361, officialKm: null, services: ALL },
  { step: 5, name: "Pontivy", lat: 48.0686, lon: -2.9631, officialKm: null, services: ALL },
  { step: 6, name: "Pleyben", lat: 48.2253, lon: -3.9692, officialKm: null, services: ALL },
  { step: 7, name: "Brest", lat: 48.3904, lon: -4.4861, officialKm: 590, services: NO_MECA },
  { step: 8, name: "Callac", lat: 48.4031, lon: -3.4278, officialKm: null, services: ALL },
  { step: 9, name: "Loudéac", lat: 48.1781, lon: -2.7536, officialKm: null, services: ALL },
  { step: 10, name: "Tinténiac", lat: 48.3283, lon: -1.8361, officialKm: null, services: ALL },
  { step: 11, name: "Pleine-Fougères", lat: 48.5333, lon: -1.5667, officialKm: null, services: NO_MECA, note: "Assistance totalement interdite" },
  { step: 12, name: "Fougères", lat: 48.3525, lon: -1.1986, officialKm: null, services: ALL },
  { step: 13, name: "Villaines-la-Juhel", lat: 48.3433, lon: -0.2786, officialKm: null, services: ALL },
  { step: 14, name: "Mortagne-au-Perche", lat: 48.5203, lon: 0.5472, officialKm: null, services: ALL },
  { step: 15, name: "Chartres", lat: 48.4469, lon: 1.4892, officialKm: null, services: ALL },
  { step: 16, name: "Rambouillet (arrivée)", lat: 48.6436, lon: 1.8295, officialKm: 1220, services: ["controle", "restauration", "douches"] },
];

export interface DepartureWave {
  id: string;
  label: string;
  start: string; // ISO, heure de Paris (CEST)
  limitHours: number;
}

// Vagues de départ publiées (une vague toutes les 15 min dans chaque créneau) : on
// garde le premier départ de chaque créneau, l'utilisateur ajuste l'heure exacte.
export const PBP_2027_WAVES: DepartureWave[] = [
  { id: "dim-16h-80h", label: "Dim. 22/08 16h00 — solos 80h", start: "2027-08-22T16:00:00+02:00", limitHours: 80 },
  { id: "dim-17h-speciales", label: "Dim. 22/08 17h00 — machines spéciales 90h", start: "2027-08-22T17:00:00+02:00", limitHours: 90 },
  { id: "dim-17h15-femmes", label: "Dim. 22/08 17h15 — vague femmes 90h", start: "2027-08-22T17:15:00+02:00", limitHours: 90 },
  { id: "dim-17h45-90h", label: "Dim. 22/08 17h45→21h15 — solos 90h", start: "2027-08-22T17:45:00+02:00", limitHours: 90 },
  { id: "lun-5h-84h", label: "Lun. 23/08 5h00 — solos 84h", start: "2027-08-23T05:00:00+02:00", limitHours: 84 },
  { id: "lun-6h-84h", label: "Lun. 23/08 6h00 — tous vélos 84h", start: "2027-08-23T06:00:00+02:00", limitHours: 84 },
];

export const PBP_2027_TOTAL_KM = 1220;

// Tracé INDICATIF en l'absence de GPX : liaisons à vol d'oiseau entre villes de
// contrôle, densifiées (un point tous les ~2 km, pour que le cap local et
// l'échantillonnage météo aient du sens), puis kilométrage recalé par morceaux sur
// les distances officielles connues (0 / 119 / 590 / 1220) — la ligne droite sous-
// estime d'environ 20 à 30 % la distance routière, ce recalage corrige l'essentiel.
// Ce n'est PAS un itinéraire et l'UI le dit clairement.
export function buildIndicativeRoute(): { points: RoutePoint[]; controlKms: number[] } {
  const ctrl = PBP_2027_CONTROLS;
  const straightCum: number[] = [0];
  for (let i = 1; i < ctrl.length; i++) straightCum.push(straightCum[i - 1] + haversineMeters(ctrl[i - 1], ctrl[i]) / 1000);

  const anchors = ctrl.map((c, i) => ({ i, km: c.officialKm })).filter((a): a is { i: number; km: number } => a.km !== null);
  const scaledKm = (straight: number): number => {
    for (let a = 1; a < anchors.length; a++) {
      const s0 = straightCum[anchors[a - 1].i];
      const s1 = straightCum[anchors[a].i];
      if (straight <= s1 || a === anchors.length - 1) {
        const t = s1 > s0 ? (straight - s0) / (s1 - s0) : 0;
        return anchors[a - 1].km + t * (anchors[a].km - anchors[a - 1].km);
      }
    }
    return straight;
  };

  const points: RoutePoint[] = [];
  for (let i = 1; i < ctrl.length; i++) {
    const a = ctrl[i - 1];
    const b = ctrl[i];
    const segKm = straightCum[i] - straightCum[i - 1];
    const steps = Math.max(1, Math.round(segKm / 2));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      points.push({
        lat: a.lat + t * (b.lat - a.lat),
        lon: a.lon + t * (b.lon - a.lon),
        ele: null,
        distKm: Math.round(scaledKm(straightCum[i - 1] + t * segKm) * 100) / 100,
      });
    }
  }
  return { points, controlKms: straightCum.map((s) => Math.round(scaledKm(s) * 10) / 10) };
}

export interface ProjectedControl extends PbpControl {
  km: number | null; // null = le tracé ne passe pas à proximité de cette ville
  offsetKm: number | null; // distance entre le centre-ville et le point du tracé retenu
}

// Seuil large : le contrôle est rarement au centre-ville exact (gymnase, lycée en
// périphérie...) et certains tracés contournent l'agglomération.
const CONTROL_MATCH_RADIUS_M = 8000;

// Projette les villes de contrôle sur un tracé. Une simple recherche du point le plus
// proche ne marche pas ici : Tinténiac, Fougères, Villaines et Mortagne sont visitées
// À L'ALLER ET AU RETOUR — il faut retrouver le bon passage. On avance donc dans
// l'ordre du parcours : pour chaque contrôle, on cherche le PREMIER passage à moins
// de CONTROL_MATCH_RADIUS_M après le contrôle précédent, et on garde le point le plus
// proche de ce passage-là (pas un passage ultérieur, même plus proche).
export function projectControls(points: RoutePoint[], controls: PbpControl[] = PBP_2027_CONTROLS): ProjectedControl[] {
  const result: ProjectedControl[] = [];
  let startIdx = 0;
  const total = points[points.length - 1].distKm;

  for (const c of controls) {
    // Départ/arrivée : par définition aux extrémités (boucle Rambouillet → Rambouillet,
    // sinon l'arrivée serait trouvée dès le premier point).
    if (c.step === 0) {
      result.push({ ...c, km: 0, offsetKm: Math.round(haversineMeters(points[0], c) / 100) / 10 });
      continue;
    }
    if (c === controls[controls.length - 1]) {
      result.push({ ...c, km: Math.round(total * 10) / 10, offsetKm: Math.round(haversineMeters(points[points.length - 1], c) / 100) / 10 });
      continue;
    }

    let bestIdx = -1;
    let bestD = Infinity;
    let inWindow = false;
    for (let i = startIdx; i < points.length; i++) {
      const d = haversineMeters(points[i], c);
      if (d <= CONTROL_MATCH_RADIUS_M) {
        inWindow = true;
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      } else if (inWindow) {
        break; // fin du premier passage à proximité
      }
    }

    if (bestIdx === -1) {
      result.push({ ...c, km: null, offsetKm: null });
    } else {
      // Affinage sur les deux segments autour du sommet retenu (km exact, pas celui
      // d'un sommet qui peut être loin sur une ligne droite simplifiée).
      const refined = projectOntoRoute(points, c, Math.max(0, bestIdx - 1), Math.min(points.length - 1, bestIdx + 1));
      result.push({ ...c, km: Math.round(refined.km * 10) / 10, offsetKm: Math.round(Math.min(bestD, refined.distanceM) / 100) / 10 });
      startIdx = bestIdx + 1;
    }
  }
  return result;
}
