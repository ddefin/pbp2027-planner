import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { actorOf } from "../../lib/adminGuard.js";
import { lastBackupAt, maxBackupAgeDays } from "../../lib/backupWatch.js";

export interface AttentionItem {
  kind: "mail_failed" | "locked" | "backup" | "strava" | "mail_config";
  level: "error" | "warn";
  title: string;
  detail: string | null;
  link: string;
}

const DAY = 86_400_000;

// Ce qui demande un coup d'œil de l'administrateur, du plus grave au moins grave.
export async function adminAttentionRoutes(app: FastifyInstance) {
  app.get("/attention", async (request, reply) => {
    actorOf(request);
    const now = new Date();
    const items: AttentionItem[] = [];

    if (!config.smtp) items.push({ kind: "mail_config", level: "error", title: "Aucun serveur mail configuré", detail: "Les réinitialisations de mot de passe ne peuvent pas partir.", link: "/admin/parametres" });

    const backup = await lastBackupAt();
    const maxDays = maxBackupAgeDays();
    if (!backup) items.push({ kind: "backup", level: "warn", title: "Aucune sauvegarde enregistrée", detail: "Planifie scripts/backup.sh sur le NAS.", link: "/admin/parametres" });
    else if (now.getTime() - backup.getTime() > maxDays * DAY)
      items.push({ kind: "backup", level: "error", title: `Dernière sauvegarde il y a ${Math.floor((now.getTime() - backup.getTime()) / DAY)} jours`, detail: `Seuil d'alerte : ${maxDays} jours.`, link: "/admin/parametres" });

    // Mails non envoyés sur 7 jours : une ligne par adresse (la plus récente), sauf si un
    // envoi a réussi depuis pour cette adresse.
    const mails = await prisma.authEvent.findMany({ where: { kind: { in: ["mail_failed", "mail_sent"] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, orderBy: { createdAt: "desc" } });
    const latest = new Map<string, (typeof mails)[number]>();
    for (const m of mails) if (!latest.has(m.email)) latest.set(m.email, m);
    for (const m of latest.values()) {
      if (m.kind !== "mail_failed") continue;
      items.push({ kind: "mail_failed", level: "error", title: `E-mail non envoyé à ${m.email}`, detail: m.detail, link: `/admin/journaux?onglet=comptes&q=${encodeURIComponent(m.email)}` });
    }

    const locked = await prisma.user.findMany({ where: { isSystem: false, suspendedAt: null, lockedUntil: { gt: now } }, select: { id: true, prenom: true, lockedUntil: true } });
    for (const u of locked) items.push({ kind: "locked", level: "warn", title: `${u.prenom} : compte verrouillé (trop d'erreurs de mot de passe)`, detail: `Jusqu'à ${u.lockedUntil!.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}.`, link: `/admin/utilisateurs/${u.id}` });

    const strava = await prisma.stravaAccount.findMany({ where: { lastSyncError: { not: null } }, select: { lastSyncError: true, user: { select: { id: true, prenom: true } } } });
    for (const s of strava) items.push({ kind: "strava", level: "warn", title: `${s.user.prenom} : synchronisation Strava en erreur`, detail: s.lastSyncError, link: `/admin/utilisateurs/${s.user.id}` });

    items.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
    return reply.send({ items });
  });
}
