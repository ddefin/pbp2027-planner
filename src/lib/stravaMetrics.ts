// Calculs d'entraînement à partir des activités Strava — fonctions pures, testées.
// Tout est ESTIMÉ : on n'a pas les flux seconde par seconde, seulement les moyennes
// d'une sortie. Le but est une tendance fiable, pas un chiffre de laboratoire.

export interface ActivityInput {
  startLocal: Date; // heure murale locale encodée comme UTC
  movingSec: number;
  distanceM: number;
  elevationM: number;
  avgHr: number | null;
  avgWatts: number | null;
  weightedWatts: number | null;
  avgSpeedMs: number | null;
  load: number;
  zone: number | null;
}

export interface AthleteSettings {
  ftp: number | null;
  maxHr: number | null;
  hrZones: [number, number][] | null; // bornes en bpm des zones 1..5
}

const DAY = 86_400_000;

// ─── Charge d'une sortie (équivalent TSS : 100 = une heure au seuil) ───

export function estimateLoad(a: { movingSec: number; avgHr: number | null; avgWatts: number | null; weightedWatts: number | null }, s: AthleteSettings): number {
  const hours = a.movingSec / 3600;
  if (hours <= 0) return 0;
  const power = a.weightedWatts ?? (a.avgWatts ? a.avgWatts * 1.05 : null);
  let intensity: number;
  if (power && s.ftp) intensity = power / s.ftp;
  else if (a.avgHr && s.maxHr) intensity = a.avgHr / (0.9 * s.maxHr); // seuil ≈ 90 % de la FC max
  else intensity = 0.65; // sans capteur : allure d'endurance
  intensity = Math.min(Math.max(intensity, 0.3), 1.3);
  return Math.round(hours * 100 * intensity * intensity * 10) / 10;
}

// Zone d'intensité 1-5 d'une sortie d'après sa FC (zones Strava) ou sa puissance moyenne.
export function estimateZone(a: { avgHr: number | null; avgWatts: number | null; weightedWatts: number | null }, s: AthleteSettings): number | null {
  if (a.avgHr && s.hrZones && s.hrZones.length >= 4) {
    const idx = s.hrZones.findIndex(([, max], i) => (max > 0 && a.avgHr! <= max) || i === s.hrZones!.length - 1);
    return Math.min(5, idx + 1);
  }
  const power = a.weightedWatts ?? a.avgWatts;
  if (power && s.ftp) {
    const r = power / s.ftp;
    return r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : r < 1.05 ? 4 : 5;
  }
  if (a.avgHr && s.maxHr) {
    const r = a.avgHr / s.maxHr;
    return r < 0.6 ? 1 : r < 0.7 ? 2 : r < 0.8 ? 3 : r < 0.9 ? 4 : 5;
  }
  return null;
}

// ─── Volumes ───

export interface Volume {
  km: number;
  hours: number;
  elevationM: number;
  rides: number;
  load: number;
}

export function sumVolume(list: ActivityInput[]): Volume {
  const v = list.reduce(
    (acc, a) => ({ km: acc.km + a.distanceM / 1000, hours: acc.hours + a.movingSec / 3600, elevationM: acc.elevationM + a.elevationM, rides: acc.rides + 1, load: acc.load + a.load }),
    { km: 0, hours: 0, elevationM: 0, rides: 0, load: 0 },
  );
  return { km: round(v.km, 1), hours: round(v.hours, 1), elevationM: Math.round(v.elevationM), rides: v.rides, load: Math.round(v.load) };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Fenêtre glissante : les `days` derniers jours, aujourd'hui inclus.
export function lastDays(list: ActivityInput[], days: number, today: Date, offsetDays = 0): ActivityInput[] {
  const end = startOfDay(today).getTime() + DAY - offsetDays * DAY;
  const start = end - days * DAY;
  return list.filter((a) => a.startLocal.getTime() >= start && a.startLocal.getTime() < end);
}

export function sinceYearStart(list: ActivityInput[], today: Date): ActivityInput[] {
  const start = Date.UTC(today.getUTCFullYear(), 0, 1);
  return list.filter((a) => a.startLocal.getTime() >= start);
}

// Semaine ISO (lundi) de chaque sortie, sur les `weeks` dernières semaines (semaine en cours incluse).
export function weeklySeries(list: ActivityInput[], weeks: number, today: Date): (Volume & { weekStart: string })[] {
  const d = startOfDay(today);
  const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
  const out: (Volume & { weekStart: string })[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = monday - w * 7 * DAY;
    const inWeek = list.filter((a) => a.startLocal.getTime() >= start && a.startLocal.getTime() < start + 7 * DAY);
    out.push({ weekStart: new Date(start).toISOString().slice(0, 10), ...sumVolume(inWeek) });
  }
  return out;
}

// ─── Forme / fatigue ───

export interface Fitness {
  ctl: number; // forme (moyenne exponentielle sur 42 j)
  atl: number; // fatigue (7 j)
  tsb: number; // fraîcheur = forme - fatigue
  acwr: number | null; // charge aiguë 7 j / charge chronique (moyenne hebdo des 28 j)
  acute: number;
  chronic: number;
}

export function fitness(list: ActivityInput[], today: Date): Fitness {
  const end = startOfDay(today).getTime();
  const dayLoad = new Map<number, number>();
  for (const a of list) {
    const k = startOfDay(a.startLocal).getTime();
    dayLoad.set(k, (dayLoad.get(k) ?? 0) + a.load);
  }
  const first = Math.min(end, ...[...dayLoad.keys()]);
  let ctl = 0;
  let atl = 0;
  for (let t = first; t <= end; t += DAY) {
    const l = dayLoad.get(t) ?? 0;
    ctl += (l - ctl) / 42;
    atl += (l - atl) / 7;
  }
  const acute = sumVolume(lastDays(list, 7, today)).load;
  const chronic = sumVolume(lastDays(list, 28, today)).load / 4;
  return {
    ctl: round(ctl, 1),
    atl: round(atl, 1),
    tsb: round(ctl - atl, 1),
    acwr: chronic > 0 ? round(acute / chronic, 2) : null,
    acute: Math.round(acute),
    chronic: Math.round(chronic),
  };
}

// ─── Répartition des intensités (modèle polarisé à 3 zones) ───

export interface IntensityShare {
  low: number; // Z1-Z2 : endurance
  mid: number; // Z3 : tempo, « zone grise »
  high: number; // Z4-Z5 : haute intensité
  coveredSeconds: number; // temps pris en compte (sorties avec capteur)
  totalSeconds: number;
}

export function intensityShare(list: ActivityInput[]): IntensityShare {
  let low = 0, mid = 0, high = 0;
  for (const a of list) {
    if (a.zone === null) continue;
    if (a.zone <= 2) low += a.movingSec;
    else if (a.zone === 3) mid += a.movingSec;
    else high += a.movingSec;
  }
  const covered = low + mid + high;
  const pct = (n: number) => (covered > 0 ? Math.round((n / covered) * 100) : 0);
  return { low: pct(low), mid: pct(mid), high: pct(high), coveredSeconds: covered, totalSeconds: list.reduce((s, a) => s + a.movingSec, 0) };
}
