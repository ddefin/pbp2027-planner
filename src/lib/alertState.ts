import { prisma } from "../db.js";

// Mémoire des alertes déjà envoyées sur le canal pour un roadbook (modèle RoadbookAlert) :
// la vérification périodique repasse toutes les quelques minutes et ne doit pas répéter la
// même alerte. `cooldownMs` = Infinity pour une alerte à envoyer une seule fois.
export async function isAlertDue(roadbookId: string, key: string, cooldownMs: number, now = new Date()): Promise<boolean> {
  const existing = await prisma.roadbookAlert.findUnique({ where: { roadbookId_key: { roadbookId, key } } });
  if (!existing) return true;
  return cooldownMs !== Infinity && now.getTime() - existing.sentAt.getTime() >= cooldownMs;
}

// À appeler APRÈS un envoi réussi : une alerte que Telegram a refusée (canal mal
// configuré, réseau) reste "due" et sera retentée au prochain passage.
export async function markAlertSent(roadbookId: string, keys: string[], now = new Date()): Promise<void> {
  for (const key of keys) {
    await prisma.roadbookAlert.upsert({
      where: { roadbookId_key: { roadbookId, key } },
      create: { roadbookId, key, sentAt: now },
      update: { sentAt: now },
    });
  }
}

export async function purgeOldAlerts(olderThanDays = 30, now = new Date()): Promise<void> {
  await prisma.roadbookAlert.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - olderThanDays * 86_400_000) } } });
}
