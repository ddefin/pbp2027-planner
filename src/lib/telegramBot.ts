import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getTelegramUpdates, sendTelegramMessage } from "./telegram.js";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;
// Délai entre deux tentatives après une erreur réseau sur getUpdates (le bot
// reste indisponible le temps que Telegram ou le réseau se rétablisse, mais la
// boucle ne doit pas marteler l'API en continu pendant une panne).
const RETRY_DELAY_MS = 5000;

// Un seul code actif à la fois par utilisateur : en demander un nouveau
// invalide silencieusement le précédent, pour qu'un code oublié affiché puis
// jamais envoyé au bot ne reste pas valide indéfiniment en parallèle d'un
// nouveau.
export async function createTelegramLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  await prisma.telegramLinkCode.deleteMany({ where: { userId } });
  const code = randomBytes(4).toString("hex").toUpperCase(); // 8 caractères, facile à retaper dans Telegram
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  await prisma.telegramLinkCode.create({ data: { code, userId, expiresAt } });
  return { code, expiresAt };
}

// Exporté pour être testé directement (voir test/news.test.ts) sans passer par
// une vraie boucle de long-polling, qui ne se prête pas à un test synchrone.
export async function handleTelegramStartCommand(chatId: string, code: string): Promise<void> {
  const entry = await prisma.telegramLinkCode.findUnique({ where: { code } });
  if (!entry || entry.expiresAt < new Date()) {
    await sendTelegramMessage(
      chatId,
      "Code invalide ou expiré. Récupère un nouveau code depuis « Mon profil » sur le site, puis renvoie /start suivi du code.",
    );
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: entry.userId } });
  await prisma.telegramLink.upsert({
    where: { userId: entry.userId },
    create: { userId: entry.userId, chatId },
    update: { chatId },
  });
  await prisma.telegramLinkCode.delete({ where: { code } }).catch(() => undefined);

  await sendTelegramMessage(
    chatId,
    `C'est fait${user ? `, ${user.prenom}` : ""} ! Tu recevras ici tes notifications personnalisées (changement de statut sur un BRM choisi).`,
  );
}

let pollingActive = false;

// Démarrée une fois au lancement du serveur (voir src/server.ts), seulement si
// un token est configuré. Long-polling plutôt qu'un webhook public : pas de
// route à exposer ni d'appel setWebhook à faire soi-même, adapté à un service
// auto-hébergé sur une IP résidentielle/NAS sans certificat géré pour un
// deuxième usage.
export function startTelegramPolling(): void {
  if (pollingActive || !config.telegramBotToken) return;
  pollingActive = true;
  let offset = 0;

  (async function loop() {
    while (pollingActive) {
      let updates: Awaited<ReturnType<typeof getTelegramUpdates>>;
      try {
        updates = await getTelegramUpdates(offset);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      if (updates.length === 0) continue;

      for (const update of updates) {
        offset = update.update_id + 1;
        const chatId = update.message?.chat.id;
        const text = update.message?.text?.trim();
        if (chatId === undefined || !text) continue;

        const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9]+)$/.exec(text);
        if (match) {
          await handleTelegramStartCommand(String(chatId), match[1].toUpperCase()).catch(() => undefined);
        } else if (/^\/start(?:@\w+)?$/.test(text)) {
          await sendTelegramMessage(
            String(chatId),
            "Pour lier ton compte, récupère ton code depuis « Mon profil » sur le site (section Telegram), puis renvoie-le ici précédé de /start.",
          ).catch(() => undefined);
        }
      }
    }
  })().catch(() => {
    // getTelegramUpdates absorbe déjà ses propres erreurs réseau (retourne []) ;
    // ce filet n'attrape que l'imprévu, pour ne jamais faire planter le serveur.
    pollingActive = false;
  });
}

export function stopTelegramPolling(): void {
  pollingActive = false;
}
