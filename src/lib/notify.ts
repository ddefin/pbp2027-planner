import { prisma } from "../db.js";
import { sendTelegramMessage } from "./telegram.js";

// Notification personnelle, déclenchée par une action sur le compte de
// l'utilisateur (pour l'instant : choix/statut sur un BRM du calendrier, voir
// src/routes/brmCatalog.ts) — toujours créée en base (visible dans la cloche de
// l'app, cf. GET /notifications), et envoyée en plus sur Telegram si le compte
// y est lié. Jamais bloquant pour l'action d'origine : appelé en void/catch par
// l'appelant, jamais attendu dans la réponse HTTP.
export async function notifyUser(userId: string, kind: string, message: string, link: string | null = null): Promise<void> {
  await prisma.notification.create({ data: { userId, kind, message, link } });

  const telegramLink = await prisma.telegramLink.findUnique({ where: { userId } });
  if (telegramLink) {
    await sendTelegramMessage(telegramLink.chatId, message).catch(() => undefined);
  }
}
