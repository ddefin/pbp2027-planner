import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { sendTelegramNewsMessage } from "./telegram.js";

// scripts/backup.sh (sur le NAS) écrit l'heure de la dernière sauvegarde réussie dans
// ce fichier, DANS le volume de données du conteneur. Le serveur le relit chaque jour :
// une sauvegarde qui ne tourne plus (tâche DSM supprimée, disque plein) se voit enfin.
const HEARTBEAT = () => process.env.BACKUP_HEARTBEAT_FILE ?? path.resolve(process.cwd(), "data", ".last-backup");
const KEY = "backup-alert";
const RENOTIFY_MS = 3 * 86_400_000;

export function maxBackupAgeDays(): number {
  const n = Number(process.env.BACKUP_MAX_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export async function lastBackupAt(): Promise<Date | null> {
  try {
    const seconds = Number((await readFile(HEARTBEAT(), "utf8")).trim());
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
  } catch {
    return null;
  }
}

export async function checkBackup(now = new Date()): Promise<{ ok: boolean; notified: boolean; lastAt: Date | null }> {
  const lastAt = await lastBackupAt();
  const ageDays = lastAt ? (now.getTime() - lastAt.getTime()) / 86_400_000 : Infinity;
  if (ageDays <= maxBackupAgeDays()) return { ok: true, notified: false, lastAt };

  const state = await prisma.watchedPage.findUnique({ where: { key: KEY } });
  if (state?.lastNotifiedAt && now.getTime() - state.lastNotifiedAt.getTime() < RENOTIFY_MS) return { ok: false, notified: false, lastAt };

  const message = lastAt
    ? `💾 Aucune sauvegarde de la base depuis ${Math.floor(ageDays)} jours (dernière : ${lastAt.toLocaleDateString("fr-FR")}). Vérifie la tâche planifiée « backup.sh » sur le NAS.`
    : "💾 Aucune sauvegarde de la base enregistrée. Planifie scripts/backup.sh sur le NAS (voir DEPLOY.md, « Sauvegardes »).";
  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } });
  for (const a of admins) await prisma.notification.create({ data: { userId: a.id, kind: "backup", message, link: null } });
  await sendTelegramNewsMessage(message).catch(() => undefined);
  await prisma.watchedPage.upsert({
    where: { key: KEY },
    create: { key: KEY, contentHash: "", routePending: false, routeLinks: "[]", checkedAt: now, lastNotifiedAt: now },
    update: { checkedAt: now, lastNotifiedAt: now },
  });
  return { ok: false, notified: true, lastAt };
}
