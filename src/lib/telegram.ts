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

// false = bot non configuré (l'appelant continue sans notification plutôt que de
// planter, même logique que sendPasswordResetEmail) ou envoi échoué.
export async function sendTelegramMessage(chatId: string, text: string, options: { linkPreview?: boolean } = {}): Promise<boolean> {
  if (!config.telegramBotToken) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: options.linkPreview === false }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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
    chat: { id: number; type?: string };
    text?: string;
    location?: { latitude: number; longitude: number };
  };
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
    const res = await fetch(`${apiUrl("getUpdates")}?timeout=25&offset=${offset}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`getUpdates: HTTP ${res.status}`);
    const data = (await res.json()) as { result?: TelegramUpdate[] };
    return data.result ?? [];
  } finally {
    clearTimeout(timeout);
  }
}
