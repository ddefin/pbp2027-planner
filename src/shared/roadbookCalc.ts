// Calculs du roadbook BRM — fonctions pures, AUCUN import (ni Node, ni navigateur) :
// source unique partagée par le serveur (résumé de situation Telegram) et le frontend
// (page du roadbook, lien de suivi), qui la ré-exporte via web/src/lib/roadbook.ts.
// Le build Docker du frontend copie ce dossier (voir Dockerfile). Toutes les durées
// sont en MINUTES depuis le départ.

export const BRM_CLASSES = [200, 300, 400, 600] as const;
export type BrmClass = (typeof BRM_CLASSES)[number];

// Délais officiels ACP du brevet complet.
export const OFFICIAL_LIMIT_MINUTES: Record<BrmClass, number> = {
  200: 13 * 60 + 30,
  300: 20 * 60,
  400: 27 * 60,
  600: 40 * 60,
};

// Barème ACP/RUSA des heures d'ouverture (vitesse MAX) et de fermeture (vitesse MIN)
// des contrôles, par tranche de distance. Calcul par tranches cumulées : les 200
// premiers km à 34 km/h, les 200 suivants à 32, etc.
const OPEN_BRACKETS: [number, number][] = [
  [200, 34],
  [400, 32],
  [600, 30],
  [1000, 28],
  [1300, 26],
];
const CLOSE_BRACKETS: [number, number][] = [
  [600, 15],
  [1000, 11.428],
  [1300, 13.333],
];

function bracketMinutes(km: number, brackets: [number, number][]): number {
  let minutes = 0;
  let prev = 0;
  for (const [upTo, speed] of brackets) {
    const seg = Math.min(km, upTo) - prev;
    if (seg <= 0) break;
    minutes += (seg / speed) * 60;
    prev = upTo;
  }
  return minutes;
}

// Heures d'ouverture / fermeture d'un contrôle situé à `km`, pour un brevet de
// distance nominale `classKm` et de délai total `limitMinutes`.
// Règles appliquées (calcul standard des calculateurs ACP/RUSA) :
//  - contrôles à 60 km ou moins du départ : fermeture à 20 km/h + 1 h (sinon un
//    contrôle à 10 km fermerait 40 min après le départ, ce qui pénaliserait un
//    départ groupé lent) ;
//  - contrôle d'arrivée (ou au-delà de la distance nominale, un 200 faisant souvent
//    203-210 km) : calculé sur la distance nominale, fermeture = délai officiel.
// La carte de route remise par l'organisateur fait foi en cas d'écart.
export function controlWindow(km: number, classKm: number, limitMinutes: number): { openMin: number; closeMin: number } {
  if (km >= classKm) return { openMin: Math.round(bracketMinutes(classKm, OPEN_BRACKETS)), closeMin: limitMinutes };
  if (km <= 0) return { openMin: 0, closeMin: 60 };
  const openMin = Math.round(bracketMinutes(km, OPEN_BRACKETS));
  const closeMin = km <= 60 ? Math.round((km / 20) * 60 + 60) : Math.round(bracketMinutes(km, CLOSE_BRACKETS));
  return { openMin, closeMin: Math.min(closeMin, limitMinutes) };
}

export interface RoadbookControl {
  name: string;
  km: number;
  stopMinutes: number; // pause prévue à ce contrôle
  lat?: number | null;
  lon?: number | null;
}

export interface PacingSettings {
  movingSpeedKmh: number; // vitesse "roulée", hors arrêts
  climbPenaltyMinPer100m: number; // minutes ajoutées par tranche de 100 m de D+ (0 = ignoré)
  classKm: number; // distance nominale du brevet (200/300/... ou sur-mesure)
  limitMinutes: number;
}

export interface ScheduleRow {
  index: number;
  name: string;
  km: number;
  legKm: number;
  legGainM: number | null;
  arriveMin: number; // arrivée prévue (minutes depuis le départ)
  departMin: number; // = arrivée + pause
  stopMinutes: number;
  openMin: number;
  closeMin: number;
  marginMin: number; // fermeture du contrôle - arrivée prévue (négatif = hors délai)
}

export interface ElevationSample {
  distKm: number;
  ele: number | null;
}

// D+ entre deux km, seuil de bruit de 2 m (cohérent avec le reste de l'app).
export function gainBetween(points: ElevationSample[], fromKm: number, toKm: number): number | null {
  let gain = 0;
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
    } else if (d <= -2) last = p.ele;
  }
  return any ? Math.round(gain) : null;
}

// Durée de roulage d'un tronçon (minutes), pénalité de montée comprise.
function rideMinutes(legKm: number, legGainM: number | null, s: PacingSettings): number {
  return (legKm / s.movingSpeedKmh) * 60 + ((legGainM ?? 0) / 100) * s.climbPenaltyMinPer100m;
}

// Roadbook complet : contrôles triés par km, le premier étant le départ. La pause du
// dernier contrôle (arrivée) n'est pas comptée : le brevet s'arrête au tampon final.
export function buildSchedule(controls: RoadbookControl[], points: ElevationSample[], s: PacingSettings): ScheduleRow[] {
  const sorted = [...controls].sort((a, b) => a.km - b.km);
  const rows: ScheduleRow[] = [];
  let clock = 0;
  let prevKm = 0;
  sorted.forEach((c, i) => {
    const legKm = Math.max(0, c.km - prevKm);
    const legGainM = i === 0 ? null : gainBetween(points, prevKm, c.km);
    if (i > 0) clock += rideMinutes(legKm, legGainM, s);
    const arriveMin = Math.round(clock);
    const isLast = i === sorted.length - 1;
    const stop = isLast ? 0 : c.stopMinutes;
    // L'arrivée ferme TOUJOURS au délai officiel, même si le GPX fait un peu moins
    // que la distance nominale (199,8 km pour un 200) — sinon elle hériterait d'une
    // fermeture au barème kilométrique (13h19 au lieu de 13h30).
    const { openMin, closeMin } = isLast
      ? { openMin: controlWindow(Math.min(c.km, s.classKm), s.classKm, s.limitMinutes).openMin, closeMin: s.limitMinutes }
      : controlWindow(c.km, s.classKm, s.limitMinutes);
    rows.push({
      index: i,
      name: c.name,
      km: c.km,
      legKm: Math.round(legKm * 10) / 10,
      legGainM,
      arriveMin,
      departMin: arriveMin + stop,
      stopMinutes: stop,
      openMin,
      closeMin,
      marginMin: closeMin - arriveMin,
    });
    clock += stop;
    prevKm = c.km;
  });
  return rows;
}

// Minute prévue (depuis le départ) au km donné, en suivant le roadbook : entre deux
// contrôles, on avance au rythme du tronçon à partir de la SORTIE du précédent (pause
// faite) ; pile à un contrôle, c'est l'heure d'ARRIVÉE prévue qui compte — sinon, en
// pointant, on se croirait en avance d'une pause qu'on n'a pas encore prise.
export function plannedMinuteAt(schedule: ScheduleRow[], km: number): number {
  if (schedule.length === 0) return 0;
  if (km <= schedule[0].km) return schedule[0].departMin;
  for (let i = 1; i < schedule.length; i++) {
    const a = schedule[i - 1];
    const b = schedule[i];
    if (km <= b.km) {
      const t = b.km > a.km ? (km - a.km) / (b.km - a.km) : 1;
      return a.departMin + t * (b.arriveMin - a.departMin);
    }
  }
  return schedule[schedule.length - 1].arriveMin;
}

export type StatusLevel = "ok" | "tight" | "late";

export interface LiveStatus {
  km: number;
  elapsedMin: number;
  // Objectif personnel : positif = en avance sur son roadbook.
  planDeltaMin: number;
  planLevel: StatusLevel;
  // Barrière éliminatoire : prochain contrôle encore à atteindre.
  nextControl: ScheduleRow | null;
  // Marge à l'arrivée au prochain contrôle EN ROULANT à sa vitesse habituelle, sans
  // pause : c'est la vraie question sur le terrain ("si je repars maintenant, est-ce
  // que ça passe ?"). Négatif = on n'y arrivera pas avant la fermeture à ce rythme.
  barrierMarginMin: number | null;
  barrierLevel: StatusLevel;
  requiredSpeedNextKmh: number | null; // pour atteindre le prochain contrôle à sa fermeture
  requiredSpeedFinishKmh: number | null; // moyenne arrêts compris pour finir dans le délai
  remainingKm: number;
  // Le prochain contrôle est déjà fermé (ou, après l'arrivée, le délai est dépassé).
  // Seuls les contrôles ont une heure de fermeture dans le règlement BRM : rouler
  // sous les 15 km/h ENTRE deux contrôles n'élimine pas tant qu'on atteint le
  // suivant à temps — on ne compare donc jamais à une "fermeture au km courant".
  closedAlready: boolean;
}

const TIGHT_PLAN_MIN = 30;
const TIGHT_BARRIER_MIN = 45;

export function computeLiveStatus(params: {
  schedule: ScheduleRow[];
  km: number;
  elapsedMin: number;
  settings: PacingSettings;
  totalKm: number;
}): LiveStatus {
  const { schedule, km, elapsedMin, settings, totalKm } = params;
  const planDeltaMin = Math.round(plannedMinuteAt(schedule, km) - elapsedMin);
  const planLevel: StatusLevel = planDeltaMin >= 0 ? "ok" : planDeltaMin >= -TIGHT_PLAN_MIN ? "tight" : "late";

  const next = schedule.find((r) => r.km > km + 0.05) ?? null;
  let barrierMarginMin: number | null = null;
  let requiredSpeedNextKmh: number | null = null;
  if (next) {
    const distance = next.km - km;
    const etaAtNext = elapsedMin + (distance / settings.movingSpeedKmh) * 60;
    barrierMarginMin = Math.round(next.closeMin - etaAtNext);
    const minutesLeft = next.closeMin - elapsedMin;
    requiredSpeedNextKmh = minutesLeft > 0 ? Math.round((distance / (minutesLeft / 60)) * 10) / 10 : null;
  }

  const closedAlready = next ? elapsedMin > next.closeMin : elapsedMin > settings.limitMinutes;
  const barrierLevel: StatusLevel =
    closedAlready || (barrierMarginMin !== null && barrierMarginMin < 0)
      ? "late"
      : barrierMarginMin !== null && barrierMarginMin < TIGHT_BARRIER_MIN
        ? "tight"
        : "ok";

  const remainingKm = Math.max(0, totalKm - km);
  const minutesToLimit = settings.limitMinutes - elapsedMin;
  const requiredSpeedFinishKmh = remainingKm === 0 ? null : minutesToLimit > 0 ? Math.round((remainingKm / (minutesToLimit / 60)) * 10) / 10 : null;

  return {
    km,
    elapsedMin,
    planDeltaMin,
    planLevel,
    nextControl: next,
    barrierMarginMin,
    barrierLevel,
    requiredSpeedNextKmh,
    requiredSpeedFinishKmh,
    remainingKm: Math.round(remainingKm * 10) / 10,
    closedAlready,
  };
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? "−" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

// Recalage d'une position GPS sur le tracé. Sur un brevet en boucle ou en
// aller-retour, le point le plus proche peut appartenir à l'autre sens (km 20 au lieu
// de km 180 sur la même route, ou le départ au lieu de l'arrivée d'une boucle) : on
// cherche d'abord dans une fenêtre autour du dernier km connu (un peu en arrière,
// nettement en avant), puis partout EN AVANT de ce km, et seulement en dernier
// recours sur tout le tracé (cas d'une première position, ou d'un gros détour).
export function snapToRoute(
  points: { lat: number; lon: number; distKm: number }[],
  pos: { lat: number; lon: number },
  hintKm: number | null,
): { km: number; offsetKm: number } {
  // Projection sur les SEGMENTS (pas seulement les sommets) : un tracé simplifié peut
  // n'avoir que deux sommets sur plusieurs km de ligne droite.
  const cos = Math.cos((pos.lat * Math.PI) / 180);
  const x = (p: { lon: number }) => (p.lon - pos.lon) * cos * 111.32;
  const y = (p: { lat: number }) => (p.lat - pos.lat) * 110.57;
  const search = (fromKm: number, toKm: number) => {
    let best: { km: number; d: number } | null = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (b.distKm < fromKm || a.distKm > toKm) continue;
      const ax = x(a), ay = y(a), dx = x(b) - ax, dy = y(b) - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.d) best = { km: a.distKm + t * (b.distKm - a.distKm), d };
    }
    if (!best && points.length === 1) best = { km: points[0].distKm, d: Math.hypot(x(points[0]), y(points[0])) };
    return best;
  };
  if (hintKm !== null) {
    const local = search(hintKm - 5, hintKm + 60);
    if (local && local.d < 2) return { km: local.km, offsetKm: local.d };
    const ahead = search(hintKm - 5, Infinity);
    if (ahead && ahead.d < 2) return { km: ahead.km, offsetKm: ahead.d };
  }
  const global = search(-Infinity, Infinity)!;
  return { km: global.km, offsetKm: global.d };
}

// Nom de waypoint GPX qui ressemble à un contrôle (CP, pointage, tampon...) plutôt
// qu'à un simple point d'intérêt (boulangerie, fontaine, danger).
export function looksLikeControl(name: string): boolean {
  return /(contr[oô]le|\bcp\s?\d*\b|check|pointage|tampon|control|d[ée]part|arriv[ée]e|start|finish|secret)/i.test(name);
}

// ─── Plan nutrition et ravitaillement ───

export interface NutritionSettings {
  waterMlPerHour: number; // 500 ml/h par défaut (plus par forte chaleur)
  carbsGPerHour: number; // 60 g/h par défaut (effort long)
  bottleMl: number; // capacité embarquée (2 bidons de 750 ml par défaut)
}

export const DEFAULT_NUTRITION: NutritionSettings = { waterMlPerHour: 500, carbsGPerHour: 60, bottleMl: 1500 };

export interface ResupplyPoint {
  name: string;
  km: number;
  kind: "controle" | "eau" | "ravito";
}

export interface NutritionSegment {
  from: string;
  to: string;
  fromKm: number;
  toKm: number;
  km: number;
  rideMin: number; // temps de roulage (hors pause au contrôle de départ)
  waterMl: number;
  carbsG: number;
  kcal: number;
  // Points de réapprovisionnement ENTRE les deux contrôles (hors contrôles).
  stops: ResupplyPoint[];
  // Plus longue distance sans rien (ni contrôle ni point d'eau/ravito) dans le tronçon.
  longestGapKm: number;
  // La réserve embarquée ne couvre pas ce tronçon sans réapprovisionnement.
  needsRefill: boolean;
}

export interface NutritionPlan {
  segments: NutritionSegment[];
  totalWaterL: number;
  totalCarbsG: number;
  totalKcal: number;
}

const WATER_RE = /(fontaine|\beau\b|water|cimeti[eè]re|point d'eau|robinet)/i;
const FOOD_RE = /(boulang|p[aâ]tiss|supermarch|sup[eé]rette|[eé]picerie|ravito|caf[eé]|bar\b|restaurant|bistro|snack|boucher|carrefour|intermarch|leclerc|lidl|aldi|casino|auchan|u express|vival|spar\b|petit casino|station)/i;

export function classifyPoi(name: string): "eau" | "ravito" | null {
  if (WATER_RE.test(name)) return "eau";
  if (FOOD_RE.test(name)) return "ravito";
  return null;
}

// Besoins par tronçon (entre deux contrôles consécutifs) d'après le temps de ROULAGE
// du planning, et vérification de l'autonomie : la réserve embarquée suffit-elle
// jusqu'au prochain point de réapprovisionnement ?
export function nutritionPlan(
  schedule: ScheduleRow[],
  pois: { name: string; km: number }[],
  settings: NutritionSettings = DEFAULT_NUTRITION,
): NutritionPlan {
  const segments: NutritionSegment[] = [];
  for (let i = 0; i < schedule.length - 1; i++) {
    const a = schedule[i];
    const b = schedule[i + 1];
    const km = Math.max(0, b.km - a.km);
    const rideMin = Math.max(0, b.arriveMin - a.departMin);
    const hours = rideMin / 60;
    const waterMl = Math.round(hours * settings.waterMlPerHour);
    const carbsG = Math.round(hours * settings.carbsGPerHour);
    const stops: ResupplyPoint[] = pois
      .filter((p) => p.km > a.km + 0.2 && p.km < b.km - 0.2)
      .flatMap((p): ResupplyPoint[] => {
        const kind = classifyPoi(p.name);
        return kind ? [{ name: p.name, km: p.km, kind }] : [];
      })
      .sort((x, y) => x.km - y.km);
    const marks = [a.km, ...stops.map((s) => s.km), b.km];
    let longestGapKm = 0;
    for (let j = 1; j < marks.length; j++) longestGapKm = Math.max(longestGapKm, marks[j] - marks[j - 1]);
    // Eau nécessaire sur le plus long tronçon sans point : proportionnelle à sa part du temps de roulage.
    const gapWaterMl = km > 0 ? waterMl * (longestGapKm / km) : 0;
    segments.push({
      from: a.name,
      to: b.name,
      fromKm: a.km,
      toKm: b.km,
      km: Math.round(km * 10) / 10,
      rideMin: Math.round(rideMin),
      waterMl,
      carbsG,
      kcal: carbsG * 4,
      stops,
      longestGapKm: Math.round(longestGapKm * 10) / 10,
      needsRefill: gapWaterMl > settings.bottleMl,
    });
  }
  const totalCarbsG = segments.reduce((s, x) => s + x.carbsG, 0);
  return {
    segments,
    totalWaterL: Math.round(segments.reduce((s, x) => s + x.waterMl, 0) / 100) / 10,
    totalCarbsG,
    totalKcal: totalCarbsG * 4,
  };
}
