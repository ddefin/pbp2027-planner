import { prisma } from "../db.js";
import { snapToRoute, type RoadbookControl } from "../shared/roadbookCalc.js";
import { buildSituationMessage, decodeRoadbookPoints, recordCheckin, type AnnounceOutcome } from "./roadbookSituation.js";
import { escapeHtml, explainTelegramError } from "./telegram.js";

// Au-delà, la position n'est sans doute pas sur ce brevet (mauvais roadbook actif,
// position envoyée depuis la maison...) : on refuse plutôt que d'enregistrer un km
// absurde qui fausserait le statut partagé.
const MAX_OFF_ROUTE_KM = 10;

export const TRACKING_HELP = [
  "<b>Pointer pendant un brevet</b> (un seul relevé à chaque fois, aucun suivi continu) :",
  "📎 → <b>Position</b> → « Envoyer ma position actuelle » : pointage GPS",
  "<code>/km 125</code> : je suis au km 125",
  "<code>/cp</code> : liste des contrôles · <code>/cp 2</code> : pointé au contrôle n°2",
  "<code>/statut</code> : ma situation, sans pointer",
  "",
  "Le pointage s'applique à ton roadbook en cours (celui dont le départ est le plus récent).",
].join("\n");

// Roadbook "en cours" : celui dont le départ est passé et dont le délai (+ 6 h de
// marge pour les retardataires) n'est pas écoulé ; sinon le prochain à partir ; sinon
// le dernier modifié. Évite d'avoir à choisir à chaque pointage.
export async function findActiveRoadbook(userId: string, now = new Date()) {
  const all = await prisma.roadbook.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  if (all.length === 0) return null;
  const running = all
    .filter((r) => r.startAt && r.startAt <= now && now.getTime() <= r.startAt.getTime() + (r.limitMinutes + 6 * 60) * 60_000)
    .sort((a, b) => b.startAt!.getTime() - a.startAt!.getTime());
  if (running[0]) return running[0];
  const upcoming = all.filter((r) => r.startAt && r.startAt > now).sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime());
  return upcoming[0] ?? all[0];
}

type Incoming = { text?: string; location?: { latitude: number; longitude: number } };

// Réponse au randonneur : son résumé + ce qui s'est RÉELLEMENT passé côté canal (pas
// un "publié" de principe si Telegram a refusé).
async function confirmation(announced: Promise<AnnounceOutcome>): Promise<string> {
  const { message, publication } = await announced;
  const status =
    publication.status === "published"
      ? "✅ Pointage enregistré et publié sur le canal."
      : publication.status === "disabled"
        ? "✅ Pointage enregistré (publication sur le canal désactivée dans ton roadbook)."
        : publication.status === "cooldown"
          ? "✅ Pointage enregistré (déjà publié il y a moins de 2 min : pas republié sur le canal)."
          : `⚠️ Pointage enregistré, mais PAS publié sur le canal.\nMotif : ${escapeHtml(publication.error)}\n${escapeHtml(explainTelegramError(publication.error))}`;
  return message ? `${status}\n\n${message}` : status;
}

// Traite un message privé d'un randonneur déjà lié (TelegramLink). Renvoie la réponse
// à lui envoyer, ou null si le message ne concerne pas le pointage.
export async function handleTrackingMessage(chatId: string, msg: Incoming): Promise<string | null> {
  const text = msg.text?.trim() ?? "";
  const isCommand = /^\/(km|cp|statut|aide|help)\b/i.test(text);
  if (!msg.location && !isCommand) return null;

  if (/^\/(aide|help)\b/i.test(text)) return TRACKING_HELP;

  const link = await prisma.telegramLink.findUnique({ where: { chatId } });
  if (!link) return "Ton compte Telegram n'est pas encore lié : sur le site, « Mon profil » → section Telegram → « Lier mon compte ».";

  const rb = await findActiveRoadbook(link.userId);
  if (!rb) return "Tu n'as aucun roadbook : importe d'abord le GPX de ton brevet sur le site (menu Roadbook).";
  const title = `« ${escapeHtml(rb.title)} »`;
  const controls = (JSON.parse(rb.controls) as RoadbookControl[]).sort((a, b) => a.km - b.km);

  if (/^\/statut\b/i.test(text)) {
    const last = await prisma.roadbookCheckin.findFirst({ where: { roadbookId: rb.id }, orderBy: { at: "desc" } });
    if (!last) return `Aucun pointage encore sur ${title}. ${TRACKING_HELP}`;
    return (await buildSituationMessage(rb.id, last)) ?? "Situation indisponible.";
  }

  if (/^\/cp\b/i.test(text)) {
    const n = /^\/cp\s+(\d+)/i.exec(text)?.[1];
    if (n === undefined) {
      return [`Contrôles de ${title} :`, ...controls.map((c, i) => `<code>/cp ${i}</code> — ${escapeHtml(c.name)} (km ${Math.round(c.km)})`)].join("\n");
    }
    const c = controls[Number(n)];
    if (!c) return `Pas de contrôle n°${n} : envoie <code>/cp</code> pour la liste.`;
    const { announced } = await recordCheckin(rb.id, { km: c.km, lat: c.lat ?? null, lon: c.lon ?? null, source: "controle" });
    return confirmation(announced);
  }

  if (/^\/km\b/i.test(text)) {
    const km = Number((/^\/km\s+([\d.,]+)/i.exec(text)?.[1] ?? "").replace(",", "."));
    if (!Number.isFinite(km) || km < 0 || km > rb.distanceKm + 1) return `Km invalide : envoie par exemple <code>/km 125</code> (0 à ${Math.round(rb.distanceKm)}).`;
    const { announced } = await recordCheckin(rb.id, { km, lat: null, lon: null, source: "manuel" });
    return confirmation(announced);
  }

  // Position GPS envoyée depuis Telegram.
  const loc = msg.location!;
  const points = decodeRoadbookPoints(rb.points);
  const last = await prisma.roadbookCheckin.findFirst({ where: { roadbookId: rb.id }, orderBy: { at: "desc" } });
  const snapped = snapToRoute(points, { lat: loc.latitude, lon: loc.longitude }, last?.km ?? null);
  if (snapped.offsetKm > MAX_OFF_ROUTE_KM) {
    return `📍 Tu es à ${Math.round(snapped.offsetKm)} km du tracé de ${title} : pointage non enregistré. Si tu es bien sur ce brevet, envoie plutôt <code>/km &lt;kilomètre&gt;</code>.`;
  }
  const { announced } = await recordCheckin(rb.id, { km: Math.round(snapped.km * 100) / 100, lat: loc.latitude, lon: loc.longitude, source: "gps" });
  const reply = await confirmation(announced);
  return snapped.offsetKm > 0.5 ? `⚠️ Position à ${snapped.offsetKm.toFixed(1)} km du tracé, rattachée au km ${Math.round(snapped.km)}.\n${reply}` : reply;
}
