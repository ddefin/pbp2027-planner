import { prisma } from "../db.js";
import { notifyUser } from "./notify.js";
import { analyze, type CoachMetric, type CoachProfile, type CoachTone, type CoachPrefsInput } from "./stravaCoach.js";
import type { ActivityInput } from "./stravaMetrics.js";

const HISTORY_MS = 400 * 86_400_000;

export function parsePrefs(row: { profile: string; tone: string; metrics: string; goal: string | null } | null): CoachPrefsInput {
  let metrics: CoachMetric[] = ["hr", "elevation"];
  try {
    const m = JSON.parse(row?.metrics ?? "[]") as CoachMetric[];
    if (Array.isArray(m) && m.length) metrics = m;
  } catch {
    /* valeurs par défaut */
  }
  return { profile: (row?.profile as CoachProfile) ?? "endurance", tone: (row?.tone as CoachTone) ?? "bienveillant", metrics, goal: row?.goal ?? null };
}

export async function loadActivities(userId: string, now = new Date()): Promise<ActivityInput[]> {
  const rows = await prisma.stravaActivity.findMany({ where: { userId, startLocal: { gte: new Date(now.getTime() - HISTORY_MS) } }, orderBy: { startLocal: "asc" } });
  return rows.map((r) => ({ startLocal: r.startLocal, movingSec: r.movingSec, distanceM: r.distanceM, elevationM: r.elevationM, avgHr: r.avgHr, avgWatts: r.avgWatts, weightedWatts: r.weightedWatts, avgSpeedMs: r.avgSpeedMs, load: r.load, zone: r.zone }));
}

// Texte brut (cloche + message privé Telegram) : pas de caractères HTML.
const plain = (s: string) => s.replace(/</g, "moins de ").replace(/[>&]/g, "");

export async function sendCoachReport(userId: string, now = new Date()): Promise<boolean> {
  const [list, prefsRow] = await Promise.all([loadActivities(userId, now), prisma.coachPrefs.findUnique({ where: { userId } })]);
  if (list.length === 0) return false;
  const localToday = new Date(now.getTime()); // la fenêtre s'appuie sur les jours locaux des sorties
  const report = analyze(list, parsePrefs(prefsRow), localToday);
  const message = plain(`🚴 Bilan du Coach : ${report.headline.text}${report.advice[0] ? ` Conseil : ${report.advice[0]}` : ""}`);
  await notifyUser(userId, "coach", message, "/profil#strava");
  return true;
}

// Heure de Paris (jour de la semaine, heure, date) sans dépendance à un fuseau du serveur.
export function parisParts(now: Date): { weekday: string; hour: number; date: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
}

// Bilan hebdomadaire : le dimanche à partir de 18 h (Paris), une seule fois par semaine
// et par sportif (clé mémorisée dans ses réglages).
export async function sendWeeklyReports(now = new Date()): Promise<number> {
  const { weekday, hour, date } = parisParts(now);
  if (weekday !== "Sun" || hour < 18) return 0;
  const key = `week-${date}`;
  const due = await prisma.coachPrefs.findMany({ where: { frequency: "hebdo", OR: [{ lastReportKey: null }, { lastReportKey: { not: key } }], user: { stravaAccount: { isNot: null } } } });
  let sent = 0;
  for (const p of due) {
    if (await sendCoachReport(p.userId, now).catch(() => false)) sent++;
    await prisma.coachPrefs.update({ where: { userId: p.userId }, data: { lastReportKey: key } });
  }
  return sent;
}

// Bilan « après chaque sortie » : déclenché par le webhook d'une nouvelle activité.
export async function sendActivityReport(userId: string, activityId: string, now = new Date()): Promise<boolean> {
  const prefs = await prisma.coachPrefs.findUnique({ where: { userId } });
  if (prefs?.frequency !== "activite") return false;
  const key = `act-${activityId}`;
  if (prefs.lastReportKey === key) return false;
  await prisma.coachPrefs.update({ where: { userId }, data: { lastReportKey: key } });
  return sendCoachReport(userId, now);
}
