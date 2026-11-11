import { prisma } from "../db.js";
import { config } from "../config.js";
import { escapeHtml, sendTelegramLong } from "./telegram.js";
import { isAlertDue, markAlertSent, purgeOldAlerts } from "./alertState.js";
import { computeSituation, gatherSituation, linksLine, roadbookMeta, toSituationInput, type Situation } from "./roadbookSituation.js";
import { formatMinutes } from "../shared/roadbookCalc.js";
import type { WeatherAlert } from "./routeWeather.js";

// Alertes PROACTIVES sur le canal Telegram : contrairement au résumé envoyé à chaque
// pointage, elles partent toutes seules quand quelque chose cloche — y compris quand le
// randonneur ne pointe plus (batterie, zone blanche, incident).

const WEATHER_COOLDOWN_MS = 6 * 3_600_000;
const FRESH_POSITION_MS = 90 * 60_000; // au-delà, la position est trop ancienne pour une météo « devant »
const WEATHER_HORIZON_MIN = 180;

const hhmm = (d: Date) => d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const kmFmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

const WEATHER_TXT: Record<WeatherAlert, string> = {
  vent_fort: "💨 vent fort",
  vent_de_face: "🌬️ vent de face",
  pluie: "🌧️ pluie",
  froid: "🥶 froid",
  chaleur: "🥵 forte chaleur",
};

export function silenceHours(): number {
  const n = Number(process.env.ROADBOOK_SILENCE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function header(meta: { author: string; title: string }, icon: string) {
  return `${icon} <b>${escapeHtml(meta.author)}</b> · ${escapeHtml(meta.title)}`;
}

export function formatSilenceAlert(meta: { author: string; title: string; liveTrackUrl: string | null; shareUrl: string | null }, last: { km: number; at: Date }, now: Date, totalKm: number): string {
  const L = [header(meta, "📵"), ""];
  L.push(`<b>Pas de nouveau pointage depuis ${formatMinutes((now.getTime() - last.at.getTime()) / 60_000)}.</b>`);
  L.push(`Dernière position connue : km ${kmFmt(last.km)} / ${kmFmt(totalKm)} (pointage à ${hhmm(last.at)}).`);
  L.push("Ce n'est peut-être qu'une zone sans réseau ou une pause — à vérifier si ça dure.");
  const links = linksLine(meta);
  if (links) L.push("", links);
  return L.join("\n");
}

export function formatClosedAlert(meta: { author: string; title: string; liveTrackUrl: string | null; shareUrl: string | null }, s: Omit<Situation, "place" | "weather">, last: { km: number; at: Date }): string | null {
  const c = s.status?.nextControl;
  if (!c || !s.startAt) return null;
  const closeAt = new Date(s.startAt.getTime() + c.closeMin * 60_000);
  const L = [header(meta, "🚨"), ""];
  L.push(`<b>${escapeHtml(c.name)} (km ${Math.round(c.km)}) a fermé à ${hhmm(closeAt)}</b> et aucun pointage n'indique qu'il y est arrivé.`);
  L.push(`Dernière position connue : km ${kmFmt(last.km)} à ${hhmm(last.at)}.`);
  const links = linksLine(meta);
  if (links) L.push("", links);
  return L.join("\n");
}

async function send(roadbookId: string, html: string, keys: string[]): Promise<boolean> {
  const chatId = config.telegramTrackingChatId;
  if (!chatId) return false;
  const sent = await sendTelegramLong(chatId, html, { linkPreview: false });
  if (sent.ok) await markAlertSent(roadbookId, keys);
  else console.error("[alertes] envoi refusé :", sent.error);
  return sent.ok;
}

// Passage périodique (toutes les 10 min) sur les roadbooks en cours.
export async function checkRoadbookAlerts(now = new Date()): Promise<number> {
  if (!config.telegramTrackingChatId) return 0;
  const rows = await prisma.roadbook.findMany({
    where: { telegramAnnounce: true, startAt: { not: null } },
    include: { user: { select: { prenom: true } }, checkins: { orderBy: { at: "desc" }, take: 1 } },
  });
  let sentCount = 0;
  for (const r of rows) {
    const last = r.checkins[0];
    if (!r.startAt || !last) continue;
    const input = toSituationInput(r);
    const totalKm = input.points[input.points.length - 1].distKm;
    const endAt = r.startAt.getTime() + r.limitMinutes * 60_000;
    // Hors course : pas commencé (pointage antérieur au départ), terminé, ou délai dépassé de 2 h.
    if (now < r.startAt || now.getTime() > endAt + 2 * 3_600_000 || last.km >= totalKm - 0.5) continue;
    const meta = roadbookMeta(r);

    // 1) Silence prolongé.
    if (now.getTime() - last.at.getTime() >= silenceHours() * 3_600_000) {
      const key = `silence:${last.id}`;
      if (await isAlertDue(r.id, key, Infinity)) {
        if (await send(r.id, formatSilenceAlert(meta, last, now, totalKm), [key])) sentCount++;
      }
    }

    // 2) Contrôle fermé sans pointage : la barrière est passée alors que le dernier km
    //    connu est avant ce contrôle.
    const live = computeSituation(input, last.km, now, now);
    const c = live.status?.nextControl;
    if (c && live.status?.closedAlready && c.km < totalKm - 0.5) {
      const key = `closed:${Math.round(c.km * 10)}`;
      if (await isAlertDue(r.id, key, Infinity)) {
        const html = formatClosedAlert(meta, live, last);
        if (html && (await send(r.id, html, [key]))) sentCount++;
      }
    }

    // 3) Météo à venir (seulement si la position est récente, sinon « devant » n'a pas de sens).
    if (now.getTime() - last.at.getTime() <= FRESH_POSITION_MS) {
      const s = await gatherSituation(input, last.km, now, last.lat !== null && last.lon !== null ? { lat: last.lat, lon: last.lon } : null, now);
      for (const w of s.weather) {
        if (w.label === "Maintenant" || w.alerts.length === 0) continue;
        if ((w.at.getTime() - now.getTime()) / 60_000 > WEATHER_HORIZON_MIN) continue;
        const key = `weather:${Math.round(w.km)}:${[...w.alerts].sort().join("+")}`;
        if (!(await isAlertDue(r.id, key, WEATHER_COOLDOWN_MS, now))) continue;
        const L = [header(meta, "⛅"), ""];
        L.push(`<b>Météo à surveiller vers ${escapeHtml(w.label)}</b> (km ${Math.round(w.km)}, vers ${hhmm(w.at)}) :`);
        L.push(w.alerts.map((a) => WEATHER_TXT[a]).join(" · "));
        L.push(`${w.slot.tempC}° (ressenti ${w.slot.feelsLikeC}°), ${escapeHtml(w.slot.description)} · 💨 ${w.slot.windSpeedKmh} km/h · 💧 ${Math.round(w.slot.precipitationProbability * 100)} %`);
        const links = linksLine(meta);
        if (links) L.push("", links);
        if (await send(r.id, L.join("\n"), [key])) sentCount++;
      }
    }
  }
  await purgeOldAlerts().catch(() => undefined);
  return sentCount;
}
