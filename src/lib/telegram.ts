import { config } from "../config.js";

const API_BASE = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 8000;

function apiUrl(method: string): string {
  return `${API_BASE}/bot${config.telegramBotToken}/${method}`;
}

// À utiliser pour tout texte inséré dans un message envoyé en parse_mode HTML
// (titre d'actualité, prénom...) : évite qu'un caractère comme "&" ou "<" casse
// le format ou soit interprété comme une balise par Telegram.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type TelegramSendResult = { ok: true } | { ok: false; error: string };

// Envoi avec le motif EXACT d'un refus (Telegram répond par ex. "Bad Request: chat not
// found" ou "Forbidden: bot is not a member of the channel chat") : sans lui, un canal
// mal configuré échoue sans que personne ne sache pourquoi. Le refus est aussi écrit
// dans les logs du conteneur (docker logs). Jamais d'exception : l'appelant continue.
export async function sendTelegram(chatId: string, text: string, options: { linkPreview?: boolean } = {}): Promise<TelegramSendResult> {
  if (!config.telegramBotToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN absent" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let result: TelegramSendResult;
  try {
    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: options.linkPreview === false }),
      signal: controller.signal,
    });
    if (res.ok) {
      result = { ok: true };
    } else {
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      result = { ok: false, error: body.description ?? `HTTP ${res.status}` };
    }
  } catch (err) {
    result = { ok: false, error: `Telegram injoignable depuis le serveur (${err instanceof Error ? err.message : "erreur réseau"})` };
  } finally {
    clearTimeout(timeout);
  }
  if (!result.ok) console.error(`[telegram] envoi vers ${chatId} refusé : ${result.error}`);
  return result;
}

export async function sendTelegramMessage(chatId: string, text: string, options: { linkPreview?: boolean } = {}): Promise<boolean> {
  return (await sendTelegram(chatId, text, options)).ok;
}

// Traduit les refus Telegram les plus courants en action concrète à faire.
export function explainTelegramError(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("chat not found"))
    return "Canal introuvable pour le bot : il n'en est pas (encore) administrateur, ou l'identifiant ne correspond pas à ce canal. Ajoute le bot comme administrateur du canal, publie un message dans le canal, puis relance ce test : l'identifiant exact s'affichera ici.";
  if (e.includes("not a member") || e.includes("administrator") || e.includes("not enough rights") || e.includes("have no rights"))
    return "Le bot n'a pas le droit de publier : ajoute-le comme ADMINISTRATEUR du canal avec le droit « Publier des messages ».";
  if (e.includes("kicked") || e.includes("blocked")) return "Le bot a été retiré ou bloqué du canal : rajoute-le comme administrateur.";
  if (e.includes("unauthorized") || e.includes("token")) return "Token du bot invalide : vérifie TELEGRAM_BOT_TOKEN.";
  if (e.includes("can't parse entities")) return "Message mal formé (bug de mise en forme côté application) : signale-le avec ce message d'erreur.";
  if (e.includes("injoignable")) return "Le serveur n'arrive pas à joindre api.telegram.org (réseau, pare-feu).";
  if (e.includes("too many requests")) return "Telegram limite temporairement les envois : réessaie dans une minute.";
  return "Refus inattendu de Telegram : voir le message d'erreur ci-dessus.";
}

// Diffusion de groupe (actualités) sur le salon/canal configuré — distinct des
// messages privés de notification personnalisée (voir TelegramLink).
export async function sendTelegramNewsMessage(text: string): Promise<boolean> {
  if (!config.telegramNewsChatId) return false;
  return sendTelegramMessage(config.telegramNewsChatId, text);
}

export type TelegramUpdate = {
  update_id: number;
  // Seuls les messages NEUFS sont traités : une position "en direct" partagée dans
  // Telegram n'envoie ensuite que des edited_message, volontairement ignorés (pas de
  // suivi continu, un pointage = un message).
  message?: {
    chat: { id: number; type?: string; title?: string };
    text?: string;
    location?: { latitude: number; longitude: number };
  };
  // Le bot a été ajouté / promu / retiré d'un groupe ou canal.
  my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member: { status: string } };
  // Message publié dans un canal où le bot est administrateur.
  channel_post?: { chat: { id: number; type: string; title?: string } };
};

// Long-polling (pas de webhook public à exposer/configurer) : timeout=25 fait
// patienter Telegram jusqu'à 25s avant de répondre s'il n'y a rien de nouveau,
// voir src/lib/telegramBot.ts pour la boucle qui l'appelle en continu. Lève en
// cas d'échec réseau (plutôt que de renvoyer silencieusement []) : la boucle
// appelante distingue ainsi "rien de nouveau après 25s d'attente" (normal, pas
// besoin de ralentir) d'une vraie panne (réseau coupé, token invalide — où
// enchaîner les appels sans pause martèlerait l'API en continu).
export async function getTelegramUpdates(offset: number): Promise<TelegramUpdate[]> {
  if (!config.telegramBotToken) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    // allowed_updates explicite : Telegram mémorise la dernière liste demandée ; on veut
    // les messages privés (pointages), et savoir dans quels canaux le bot est ajouté.
    const allowed = encodeURIComponent(JSON.stringify(["message", "channel_post", "my_chat_member"]));
    const res = await fetch(`${apiUrl("getUpdates")}?timeout=25&offset=${offset}&allowed_updates=${allowed}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`getUpdates: HTTP ${res.status}`);
    const data = (await res.json()) as { result?: TelegramUpdate[] };
    return data.result ?? [];
  } finally {
    clearTimeout(timeout);
  }
}
