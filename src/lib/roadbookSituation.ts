import { prisma } from "../db.js";
import { config } from "../config.js";
import { fromCompactPoint, pointAtKm, routeBearingAt, type CompactPoint, type RoutePoint } from "./geo.js";
import { fetchCurrentAt, fetchForecastAt, pickForecastSlot, reverseGeocode, type PointForecastSlot } from "./openWeather.js";
import { alertsFor, windAlongRoute, type WeatherAlert, type WindRelation } from "./routeWeather.js";
import { escapeHtml, sendTelegramLong } from "./telegram.js";
import {
  buildSchedule,
  computeLiveStatus,
  formatMinutes,
  gainBetween,
  plannedMinuteAt,
  type LiveStatus,
  type PacingSettings,
  type RoadbookControl,
  type ScheduleRow,
} from "../shared/roadbookCalc.js";

// Évite qu'un double appui (ou un pointage web + Telegram simultanés) publie deux
// messages quasi identiques sur le canal.
const ANNOUNCE_COOLDOWN_MS = 2 * 60_000;
const MAX_CHECKINS_KEPT = 500;

export interface WeatherPoint {
  label: string;
  km: number;
  at: Date;
  slot: PointForecastSlot;
  relation: WindRelation | null;
  alongKmh: number | null;
  alerts: WeatherAlert[];
}

export interface Situation {
  km: number;
  totalKm: number;
  kmLeft: number;
  at: Date;
  startAt: Date | null;
  elapsedMin: number | null;
  avgAllKmh: number | null; // pauses comprises
  avgMovingKmh: number | null; // hors pauses (pauses PRÉVUES aux contrôles passés déduites)
  status: LiveStatus | null;
  lastControl: ScheduleRow | null;
  nextControl: ScheduleRow | null;
  nextControlEta: Date | null;
  plannedFinishAt: Date | null; // à l'allure prévue, montées et pauses restantes comprises
  paceFinishAt: Date | null; // au rythme moyen réel depuis le départ
  limitAt: Date | null;
  remainingGainM: number | null;
  place: string | null;
  weather: WeatherPoint[];
}

export interface RoadbookForSituation {
  classKm: number;
  limitMinutes: number;
  movingSpeedKmh: number;
  climbPenaltyMinPer100m: number;
  startAt: Date | null;
  controls: RoadbookControl[];
  points: RoutePoint[];
}

const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

// Partie déterministe (sans réseau) : tout ce qui se déduit du roadbook, du km pointé
// et de l'heure. Testée telle quelle ; la ville et la météo sont ajoutées ensuite.
export function computeSituation(rb: RoadbookForSituation, km: number, at: Date): Omit<Situation, "place" | "weather"> {
  const settings: PacingSettings = {
    movingSpeedKmh: rb.movingSpeedKmh,
    climbPenaltyMinPer100m: rb.climbPenaltyMinPer100m,
    classKm: rb.classKm,
    limitMinutes: rb.limitMinutes,
  };
  const totalKm = rb.points[rb.points.length - 1].distKm;
  const schedule = buildSchedule(rb.controls, rb.points, settings);
  const kmLeft = Math.max(0, totalKm - km);
  const elapsedMin = rb.startAt ? (at.getTime() - rb.startAt.getTime()) / 60_000 : null;
  const valid = elapsedMin !== null && elapsedMin > 0;

  const lastControl = [...schedule].reverse().find((r) => r.km <= km + 0.05) ?? null;
  const nextControl = schedule.find((r) => r.km > km + 0.05) ?? null;
  const plannedFromHere = (targetKm: number) => plannedMinuteAt(schedule, targetKm) - plannedMinuteAt(schedule, km);

  const stopsTaken = schedule.filter((r) => r.index > 0 && r.km < km - 0.05).reduce((s, r) => s + r.stopMinutes, 0);
  const movingMin = valid ? elapsedMin - stopsTaken : null;
  const avgAllKmh = valid && km > 0 ? (km / elapsedMin) * 60 : null;

  return {
    km,
    totalKm,
    kmLeft,
    at,
    startAt: rb.startAt,
    elapsedMin: valid ? elapsedMin : null,
    avgAllKmh,
    avgMovingKmh: movingMin !== null && movingMin > 0 && km > 0 ? (km / movingMin) * 60 : null,
    status: valid ? computeLiveStatus({ schedule, km, elapsedMin, settings, totalKm }) : null,
    lastControl,
    nextControl,
    nextControlEta: nextControl ? addMin(at, plannedFromHere(nextControl.km)) : null,
    plannedFinishAt: kmLeft > 0 ? addMin(at, plannedFromHere(totalKm)) : at,
    paceFinishAt: avgAllKmh && kmLeft > 0 ? addMin(at, (kmLeft / avgAllKmh) * 60) : null,
    limitAt: rb.startAt ? addMin(rb.startAt, rb.limitMinutes) : null,
    remainingGainM: kmLeft > 0 ? gainBetween(rb.points, km, totalKm) : 0,
  };
}

async function weatherAt(points: RoutePoint[], label: string, km: number, at: Date, current = false): Promise<WeatherPoint | null> {
  const p = pointAtKm(points, km);
  // "Maintenant" : observation réelle ; ensuite : prévision au créneau de l'heure estimée.
  const slot = current ? await fetchCurrentAt(p.lat, p.lon) : pickForecastSlot((await fetchForecastAt(p.lat, p.lon))?.slots ?? [], at);
  if (!slot) return null;
  const wind = slot.windFromDeg !== null ? windAlongRoute(slot.windFromDeg, slot.windSpeedKmh, routeBearingAt(points, km)) : null;
  return { label, km, at, slot, relation: wind?.relation ?? null, alongKmh: wind?.alongKmh ?? null, alerts: alertsFor(slot, wind?.alongKmh ?? null) };
}

// Ville + météo maintenant, au prochain contrôle et à l'arrivée (aux heures estimées).
export async function gatherSituation(rb: RoadbookForSituation, km: number, at: Date, position: { lat: number; lon: number } | null): Promise<Situation> {
  const base = computeSituation(rb, km, at);
  const here = position ?? pointAtKm(rb.points, km);

  const targets: { label: string; km: number; at: Date }[] = [{ label: "Maintenant", km, at }];
  if (base.nextControl && base.nextControlEta && base.nextControl.km < base.totalKm - 0.5) {
    targets.push({ label: base.nextControl.name, km: base.nextControl.km, at: base.nextControlEta });
  }
  if (base.kmLeft > 0 && base.plannedFinishAt) targets.push({ label: "Arrivée", km: base.totalKm, at: base.plannedFinishAt });

  const [place, ...weather] = await Promise.all([
    reverseGeocode(here.lat, here.lon),
    ...targets.map((t, i) => weatherAt(rb.points, t.label, t.km, t.at, i === 0)),
  ]);
  return { ...base, place, weather: weather.filter((w): w is WeatherPoint => w !== null) };
}

const time = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dayTime = (d: Date, ref: Date) => {
  const sameDay = d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) === ref.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  return sameDay ? time(d) : `${d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "Europe/Paris" })} ${time(d)}`;
};
const kmFmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const signed = (min: number) => (min >= 0 ? `+${formatMinutes(min)}` : formatMinutes(min));
const LEVEL_DOT = { ok: "🟢", tight: "🟠", late: "🔴" } as const;
const RELATION_TXT: Record<WindRelation, string> = { face: "de face", dos: "de dos", travers: "de travers" };
const ALERT_TXT: Record<WeatherAlert, string> = { vent_fort: "vent fort", vent_de_face: "vent de face", pluie: "pluie", froid: "froid", chaleur: "chaleur" };

function weatherEmoji(icon: string): string {
  const c = icon.slice(0, 2);
  return ({ "01": "☀️", "02": "🌤️", "03": "☁️", "04": "☁️", "09": "🌧️", "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️" } as Record<string, string>)[c] ?? "🌡️";
}

// Barre d'avancement en 10 cases : lisible d'un coup d'œil dans le canal, quel que soit
// l'appareil (pas d'alignement en colonnes, qui casse avec les polices proportionnelles).
function progressBar(km: number, total: number): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, km / total)) : 0;
  const filled = Math.round(ratio * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${Math.round(ratio * 100)} %`;
}

function weatherBlock(w: WeatherPoint, ref: Date): string {
  const s = w.slot;
  const head = w.label === "Maintenant" ? "Maintenant" : `${escapeHtml(w.label)} · vers ${dayTime(w.at, ref)}`;
  const wind = `💨 ${s.windSpeedKmh}${s.windGustsKmh ? `–${s.windGustsKmh}` : ""} km/h${w.relation ? ` ${RELATION_TXT[w.relation]}` : ""}`;
  const rain = `💧 ${Math.round(s.precipitationProbability * 100)} %${s.rainMm > 0 ? ` (${kmFmt(s.rainMm)} mm)` : ""}`;
  return `<b>${head}</b> — ${weatherEmoji(s.icon)} ${s.tempC}° (ressenti ${s.feelsLikeC}°), ${escapeHtml(s.description)}\n      ${wind} · ${rain}`;
}

// Message HTML Telegram, en blocs titrés : l'essentiel (où, combien, dans les temps ?)
// en tête, le détail ensuite. Chaque bloc ou ligne disparaît quand l'info manque (pas
// d'heure de départ, pas de météo configurée...) plutôt que d'afficher des "?".
export function formatSituationMessage(s: Situation, meta: { author: string; title: string; classKm: number; limitMinutes: number; liveTrackUrl: string | null; shareUrl: string | null }): string {
  const blocks: string[][] = [];
  const st = s.status;
  const finished = s.kmLeft === 0;

  // En-tête : qui, quel brevet, où, quand.
  const head = [`🚴 <b>${escapeHtml(meta.author)}</b> · ${escapeHtml(meta.title)}`];
  head.push(`📍 ${s.place ? `Près de <b>${escapeHtml(s.place)}</b> — ` : ""}pointage à ${time(s.at)}`);
  blocks.push(head);

  // Progression.
  const prog = ["<b>📏 PROGRESSION</b>", progressBar(s.km, s.totalKm), `Parcourus : <b>${kmFmt(s.km)} km</b> / ${kmFmt(s.totalKm)} km`];
  if (!finished) prog.push(`Restants : <b>${kmFmt(s.kmLeft)} km</b>${s.remainingGainM ? ` · D+ restant ${s.remainingGainM} m` : ""}`);
  if (s.elapsedMin !== null) prog.push(`En route depuis : ${formatMinutes(s.elapsedMin)}`);
  blocks.push(prog);

  if (finished) {
    const inTime = s.limitAt ? s.at <= s.limitAt : null;
    blocks.push([
      `🏁 <b>ARRIVÉ${s.elapsedMin !== null ? ` EN ${formatMinutes(s.elapsedMin)}` : ""}</b>`,
      inTime === null ? "" : inTime ? `✅ Dans les délais du BRM ${meta.classKm} (${formatMinutes(meta.limitMinutes)})` : `❌ Hors délai du BRM ${meta.classKm} (${formatMinutes(meta.limitMinutes)})`,
    ].filter(Boolean));
  } else if (!s.startAt) {
    blocks.push(["⏱ Heure de départ non renseignée dans le roadbook : pas de calcul d'avance/retard."]);
  } else if (s.elapsedMin === null) {
    // Pointage AVANT l'heure de départ du roadbook (essai, ou date du brevet mal saisie).
    const when = s.startAt.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    blocks.push([`⏱ Départ prévu le ${when} : pointage avant le départ, pas de calcul d'avance/retard.`]);
  } else if (st) {
    // Délais : la barrière officielle d'abord (c'est l'élimination), puis le plan perso.
    const delays = [`<b>⏱ DÉLAIS · BRM ${meta.classKm} en ${formatMinutes(meta.limitMinutes)}</b>`];
    if (st.nextControl) {
      const closeAt = s.startAt ? addMin(s.startAt, st.nextControl.closeMin) : null;
      const word = st.closedAlready ? "HORS DÉLAI" : st.barrierLevel === "ok" ? "dans les temps" : st.barrierLevel === "tight" ? "tangent" : "en retard";
      delays.push(
        `${LEVEL_DOT[st.closedAlready ? "late" : st.barrierLevel]} Barrière horaire : <b>${st.barrierMarginMin !== null ? signed(st.barrierMarginMin) : "—"}</b> · ${word}`,
      );
      delays.push(`      ${escapeHtml(st.nextControl.name)} (km ${Math.round(st.nextControl.km)})${closeAt ? ` ferme à ${dayTime(closeAt, s.at)}` : ""}`);
    }
    delays.push(`${LEVEL_DOT[st.planLevel]} Objectif perso : <b>${signed(st.planDeltaMin)}</b> ${st.planDeltaMin >= 0 ? "d'avance" : "de retard"}`);
    blocks.push(delays);
  }

  // Allure.
  if (s.avgAllKmh || (st?.requiredSpeedFinishKmh && !finished)) {
    const pace = ["<b>🚀 ALLURE</b>"];
    if (s.avgAllKmh) pace.push(`Moyenne pauses comprises : <b>${kmFmt(s.avgAllKmh)} km/h</b>`);
    if (s.avgMovingKmh) pace.push(`Moyenne hors pauses : ≈ ${kmFmt(s.avgMovingKmh)} km/h`);
    if (st?.requiredSpeedFinishKmh && !finished) pace.push(`Minimum pour finir dans les délais : ${kmFmt(st.requiredSpeedFinishKmh)} km/h`);
    blocks.push(pace);
  }

  // Arrivée estimée.
  if (!finished && s.plannedFinishAt) {
    const margin = s.limitAt ? Math.round((s.limitAt.getTime() - s.plannedFinishAt.getTime()) / 60_000) : null;
    const arr = ["<b>🏁 ARRIVÉE ESTIMÉE</b>", `<b>${dayTime(s.plannedFinishAt, s.at)}</b> à l'allure prévue (montées et pauses comprises)`];
    if (s.paceFinishAt) arr.push(`${dayTime(s.paceFinishAt, s.at)} au rythme actuel`);
    if (s.limitAt && s.elapsedMin !== null) arr.push(`Délai officiel : ${dayTime(s.limitAt, s.at)}${margin !== null ? ` · marge ${signed(margin)}` : ""}`);
    blocks.push(arr);
  }

  // Prochain contrôle.
  if (!finished && s.nextControl && s.nextControlEta && s.nextControl.km < s.totalKm - 0.5) {
    blocks.push([
      "<b>🔜 PROCHAIN CONTRÔLE</b>",
      `${escapeHtml(s.nextControl.name)} — dans ${kmFmt(s.nextControl.km - s.km)} km, vers ${dayTime(s.nextControlEta, s.at)}`,
    ]);
  }

  // Météo, puis vigilance regroupée (une seule ligne, sans doublons).
  if (s.weather.length) {
    blocks.push(["<b>🌦️ MÉTÉO SUR LE PARCOURS</b>", ...s.weather.map((w) => weatherBlock(w, s.at))]);
    const alerts = [...new Set(s.weather.flatMap((w) => w.alerts))];
    if (alerts.length) blocks.push([`⚠️ <b>Vigilance</b> : ${alerts.map((a) => ALERT_TXT[a]).join(", ")}`]);
  }

  const links: string[] = [];
  if (meta.liveTrackUrl) links.push(`<a href="${escapeHtml(meta.liveTrackUrl)}">📡 Garmin LiveTrack</a>`);
  if (meta.shareUrl) links.push(`<a href="${escapeHtml(meta.shareUrl)}">🗺️ Roadbook et suivi</a>`);
  if (links.length) blocks.push([links.join("  ·  ")]);

  return blocks.map((b) => b.join("\n")).join("\n\n");
}

export function decodeRoadbookPoints(json: string): RoutePoint[] {
  return (JSON.parse(json) as CompactPoint[]).map(fromCompactPoint);
}

type RoadbookRow = Awaited<ReturnType<typeof prisma.roadbook.findUniqueOrThrow>>;

export function toSituationInput(r: RoadbookRow): RoadbookForSituation {
  return {
    classKm: r.classKm,
    limitMinutes: r.limitMinutes,
    movingSpeedKmh: r.movingSpeedKmh,
    climbPenaltyMinPer100m: r.climbPenaltyMinPer100m,
    startAt: r.startAt,
    controls: JSON.parse(r.controls) as RoadbookControl[],
    points: decodeRoadbookPoints(r.points),
  };
}

export async function buildSituationMessage(roadbookId: string, checkin: { km: number; lat: number | null; lon: number | null; at: Date }): Promise<string | null> {
  const r = await prisma.roadbook.findUnique({ where: { id: roadbookId }, include: { user: { select: { prenom: true } } } });
  if (!r) return null;
  const situation = await gatherSituation(toSituationInput(r), checkin.km, checkin.at, checkin.lat !== null && checkin.lon !== null ? { lat: checkin.lat, lon: checkin.lon } : null);
  const shareUrl = r.shareToken && config.publicUrl ? `${config.publicUrl.replace(/\/$/, "")}/r/${r.shareToken}` : null;
  return formatSituationMessage(situation, { author: r.user.prenom, title: r.title, classKm: r.classKm, limitMinutes: r.limitMinutes, liveTrackUrl: r.liveTrackUrl, shareUrl });
}

// Même résumé, au format WhatsApp : gras en *texte*, liens écrits en clair (WhatsApp
// ne sait pas afficher un lien derrière un libellé), aucune balise HTML. La conversion
// part du message Telegram pour que les deux restent toujours identiques sur le fond.
export function toWhatsAppText(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, (_m, url: string, label: string) => `${label} : ${url.replace(/&amp;/g, "&")}`)
    .replace(/<b>([\s\S]*?)<\/b>/g, (_m, inner: string) => {
      // WhatsApp n'applique le gras que si l'astérisque touche du texte (pas d'espace).
      const lead = inner.match(/^\s*/)![0];
      const trail = inner.match(/\s*$/)![0];
      const core = inner.trim();
      return core ? `${lead}*${core}*${trail}` : inner;
    })
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// Résumé à partir du DERNIER pointage d'un roadbook (bouton « Partager sur WhatsApp »).
export async function latestSituationMessage(roadbookId: string): Promise<{ html: string; at: Date } | null> {
  const last = await prisma.roadbookCheckin.findFirst({ where: { roadbookId }, orderBy: { at: "desc" } });
  if (!last) return null;
  const html = await buildSituationMessage(roadbookId, last);
  return html ? { html, at: last.at } : null;
}

export type AnnounceOutcome = {
  message: string | null;
  publication: { status: "published" } | { status: "disabled" } | { status: "cooldown" } | { status: "error"; error: string };
};

// Enregistre un pointage (web ou Telegram), borne l'historique et publie le résumé sur
// le canal si le randonneur l'a accepté. La publication n'est jamais bloquante ni
// fatale : un canal mal configuré ne doit pas empêcher de pointer.
export async function recordCheckin(
  roadbookId: string,
  input: { km: number; lat: number | null; lon: number | null; source: "gps" | "manuel" | "controle" },
): Promise<{ checkin: { km: number; lat: number | null; lon: number | null; source: string; at: Date }; announced: Promise<AnnounceOutcome> }> {
  const checkin = await prisma.roadbookCheckin.create({ data: { roadbookId, ...input } });

  const old = await prisma.roadbookCheckin.findMany({ where: { roadbookId }, orderBy: { at: "desc" }, skip: MAX_CHECKINS_KEPT, select: { id: true } });
  if (old.length) await prisma.roadbookCheckin.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

  const announced = (async (): Promise<AnnounceOutcome> => {
    const message = await buildSituationMessage(roadbookId, checkin);
    if (!message) return { message: null, publication: { status: "error", error: "Résumé indisponible" } };
    const r = await prisma.roadbook.findUnique({ where: { id: roadbookId }, select: { telegramAnnounce: true, lastAnnouncedAt: true } });
    if (!r?.telegramAnnounce) return { message, publication: { status: "disabled" } };
    const cooledDown = !r.lastAnnouncedAt || Date.now() - r.lastAnnouncedAt.getTime() >= ANNOUNCE_COOLDOWN_MS;
    if (!cooledDown) return { message, publication: { status: "cooldown" } };

    const chatId = config.telegramTrackingChatId;
    const result = chatId
      ? await sendTelegramLong(chatId, message, { linkPreview: false })
      : { ok: false as const, error: "Canal non configuré sur le serveur (TELEGRAM_TRACKING_CHAT_ID absente de .env.production)" };
    await prisma.roadbook.update({
      where: { id: roadbookId },
      data: {
        lastAnnounceAttemptAt: new Date(),
        lastAnnounceError: result.ok ? null : result.error,
        ...(result.ok ? { lastAnnouncedAt: new Date() } : {}),
      },
    });
    return { message, publication: result.ok ? { status: "published" } : { status: "error", error: result.error } };
  })().catch((err): AnnounceOutcome => {
    console.error("[roadbook] résumé de situation impossible :", err);
    return { message: null, publication: { status: "error", error: err instanceof Error ? err.message : "erreur interne" } };
  });

  return { checkin, announced };
}
