import { prisma } from "../db.js";

// Journal des événements de compte (voir le modèle AuthEvent). Jamais bloquant : un échec
// d'écriture dans le journal ne doit jamais empêcher une connexion ou une réinitialisation.
export async function logAuthEvent(email: string, kind: string, detail?: string | null): Promise<void> {
  await prisma.authEvent
    .create({ data: { email: email.trim().toLowerCase().slice(0, 200), kind, detail: detail ? detail.slice(0, 300) : null } })
    .catch((err) => console.error("[auth] journal impossible :", err));
}

// Garde 60 jours d'historique.
export async function purgeAuthEvents(now = new Date()): Promise<number> {
  const r = await prisma.authEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 60 * 86_400_000) } } });
  return r.count;
}
