// Records personnels, défis brevets et trophées de segments, calculés sur les sorties vélo
// synchronisées (13 derniers mois) : aucun appel réseau, tout est testable tel quel.

export interface RecordActivity {
  id: string;
  name: string;
  startLocal: Date; // heure murale locale stockée comme UTC (voir StravaActivity)
  distanceM: number;
  movingSec: number;
  elevationM: number;
  maxSpeedMs: number | null;
}

export interface RecordItem {
  key: string;
  label: string;
  value: number;
  unit: "km" | "m" | "h" | "km/h" | "jours";
  activityId: string | null; // null pour une semaine, un mois, une série
  activityName: string | null;
  date: string | null; // yyyy-mm-dd (ou début de la période)
  until?: string | null; // fin de la période (série, semaine)
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const kmOf = (a: RecordActivity) => a.distanceM / 1000;

function best<T>(list: T[], score: (x: T) => number): T | null {
  let top: T | null = null;
  let s = -Infinity;
  for (const x of list) {
    const v = score(x);
    if (v > s) {
      s = v;
      top = x;
    }
  }
  return top;
}

const MIN_KM_FOR_AVG = 50;

function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return day(x);
}

export function personalRecords(list: RecordActivity[]): RecordItem[] {
  const out: RecordItem[] = [];
  const push = (key: string, label: string, a: RecordActivity | null, value: number | null, unit: RecordItem["unit"]) => {
    if (a && value !== null && value > 0) out.push({ key, label, value, unit, activityId: a.id, activityName: a.name, date: day(a.startLocal) });
  };
  const longest = best(list, kmOf);
  push("distance", "Plus longue sortie", longest, longest ? round1(kmOf(longest)) : null, "km");
  const climb = best(list, (a) => a.elevationM);
  push("elevation", "Plus gros dénivelé", climb, climb ? Math.round(climb.elevationM) : null, "m");
  const dur = best(list, (a) => a.movingSec);
  push("duration", "Plus long temps en selle", dur, dur ? round1(dur.movingSec / 3600) : null, "h");
  const avgPool = list.filter((a) => kmOf(a) >= MIN_KM_FOR_AVG && a.movingSec > 0);
  const fast = best(avgPool, (a) => a.distanceM / a.movingSec);
  push("avg", `Meilleure moyenne (${MIN_KM_FOR_AVG} km et plus)`, fast, fast ? round1((fast.distanceM / fast.movingSec) * 3.6) : null, "km/h");
  const vmax = best(list.filter((a) => a.maxSpeedMs !== null), (a) => a.maxSpeedMs ?? 0);
  push("vmax", "Vitesse max", vmax, vmax?.maxSpeedMs ? round1(vmax.maxSpeedMs * 3.6) : null, "km/h");

  // Meilleure semaine (lundi → dimanche) et meilleur mois, en km.
  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  for (const a of list) {
    const w = mondayOf(a.startLocal);
    weeks.set(w, (weeks.get(w) ?? 0) + kmOf(a));
    const m = day(a.startLocal).slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + kmOf(a));
  }
  const bw = best([...weeks.entries()], ([, km]) => km);
  if (bw && bw[1] > 0) {
    const end = new Date(`${bw[0]}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    out.push({ key: "week", label: "Meilleure semaine", value: Math.round(bw[1]), unit: "km", activityId: null, activityName: null, date: bw[0], until: day(end) });
  }
  const bm = best([...months.entries()], ([, km]) => km);
  if (bm && bm[1] > 0) out.push({ key: "month", label: "Meilleur mois", value: Math.round(bm[1]), unit: "km", activityId: null, activityName: null, date: `${bm[0]}-01` });

  // Plus longue série de jours consécutifs avec au moins une sortie.
  const days = [...new Set(list.map((a) => day(a.startLocal)))].sort();
  let run = 0;
  let bestRun = 0;
  let runStart = "";
  let bestStart = "";
  let bestEnd = "";
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (prev !== null && t - prev === 86_400_000) run++;
    else {
      run = 1;
      runStart = d;
    }
    if (run > bestRun) {
      bestRun = run;
      bestStart = runStart;
      bestEnd = d;
    }
    prev = t;
  }
  if (bestRun >= 2) out.push({ key: "streak", label: "Plus longue série", value: bestRun, unit: "jours", activityId: null, activityName: null, date: bestStart, until: bestEnd });
  return out;
}

// ─── Défis brevets ───

export const BREVET_STEPS = [200, 300, 400, 600, 1000] as const;
export const BRM_MIN_KMH = 15; // moyenne minimale d'un BRM, pauses comprises (200 km en 13 h 30 ≈ 14,8)
export const PBP_MIN_KMH = 13.3; // 1 200 km en 90 h
export const PBP_KM = 1200;

export interface BrevetChallenges {
  steps: { km: number; done: boolean; activityId: string | null; date: string | null }[];
  rides200: number;
  best200: { kmh: number; activityId: string; name: string; date: string; km: number } | null;
  bestMonth: { month: string; km: number; pct: number } | null;
}

// `elapsedSec` (temps total, pauses comprises) est ce qui compte pour les délais d'un
// brevet ; à défaut on prend le temps en mouvement (moyenne alors optimiste).
export function brevetChallenges(list: (RecordActivity & { elapsedSec?: number | null })[]): BrevetChallenges {
  const byDistDesc = [...list].sort((a, b) => b.distanceM - a.distanceM);
  const steps = BREVET_STEPS.map((km) => {
    // Le premier (le plus ancien) des trajets qui valident ce palier : « atteint le … ».
    const ok = byDistDesc.filter((a) => kmOf(a) >= km * 0.98).sort((a, b) => a.startLocal.getTime() - b.startLocal.getTime())[0];
    return { km, done: Boolean(ok), activityId: ok?.id ?? null, date: ok ? day(ok.startLocal) : null };
  });
  const long = list.filter((a) => kmOf(a) >= 196);
  const scored = long.map((a) => ({ a, kmh: (a.distanceM / (a.elapsedSec && a.elapsedSec > 0 ? a.elapsedSec : a.movingSec)) * 3.6 }));
  const top = best(scored, (x) => x.kmh);
  const months = new Map<string, number>();
  for (const a of list) {
    const m = day(a.startLocal).slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + kmOf(a));
  }
  const bm = best([...months.entries()], ([, km]) => km);
  return {
    steps,
    rides200: long.length,
    best200: top ? { kmh: round1(top.kmh), activityId: top.a.id, name: top.a.name, date: day(top.a.startLocal), km: round1(kmOf(top.a)) } : null,
    bestMonth: bm && bm[1] > 0 ? { month: bm[0], km: Math.round(bm[1]), pct: Math.min(100, Math.round((bm[1] / PBP_KM) * 100)) } : null,
  };
}

// ─── Trophées de segments ───

export interface EffortRow {
  id: string;
  activityId: string;
  segmentId: string;
  segmentName: string;
  distanceM: number;
  avgGradePct: number | null;
  climbCategory: number | null;
  city: string | null;
  elapsedSec: number;
  startLocal: Date;
  prRank: number | null;
  komRank: number | null;
}

export interface Trophy {
  id: string;
  kind: "kom" | "top10" | "pr";
  rank: number;
  segmentId: string;
  segmentName: string;
  activityId: string;
  km: number;
  gradePct: number | null;
  climbCategory: number | null;
  city: string | null;
  elapsedSec: number;
  date: string;
}

// Un segment n'apparaît qu'une fois par catégorie : son meilleur rang (puis le plus récent).
export function trophies(efforts: EffortRow[], seasonStart: Date): { kom: number; top10: number; prSeason: number; list: Trophy[] } {
  const bySeg = new Map<string, Trophy>();
  const prSeg = new Map<string, Trophy>();
  for (const e of efforts) {
    const base = {
      id: e.id,
      segmentId: e.segmentId,
      segmentName: e.segmentName,
      activityId: e.activityId,
      km: round1(e.distanceM / 1000),
      gradePct: e.avgGradePct,
      climbCategory: e.climbCategory,
      city: e.city,
      elapsedSec: e.elapsedSec,
      date: day(e.startLocal),
    };
    if (e.komRank) {
      const t: Trophy = { ...base, kind: e.komRank === 1 ? "kom" : "top10", rank: e.komRank };
      const cur = bySeg.get(e.segmentId);
      if (!cur || t.rank < cur.rank || (t.rank === cur.rank && t.date > cur.date)) bySeg.set(e.segmentId, t);
    }
    if (e.prRank === 1 && e.startLocal >= seasonStart) {
      const t: Trophy = { ...base, kind: "pr", rank: 1 };
      const cur = prSeg.get(e.segmentId);
      if (!cur || t.date > cur.date) prSeg.set(e.segmentId, t);
    }
  }
  const ranked = [...bySeg.values()].sort((a, b) => a.rank - b.rank || b.date.localeCompare(a.date));
  // PR : un par segment (le plus récent de la saison), même si ce segment est aussi un KOM.
  const prs = [...prSeg.values()].sort((a, b) => b.date.localeCompare(a.date));
  return {
    kom: ranked.filter((t) => t.kind === "kom").length,
    top10: ranked.filter((t) => t.kind === "top10").length,
    prSeason: prs.length,
    list: [...ranked, ...prs],
  };
}
