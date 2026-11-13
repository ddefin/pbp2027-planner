import { prisma } from "../db.js";
import { deleteUploadedFile } from "./fileStorage.js";
import { disconnect as disconnectStrava } from "./strava.js";

// Compte système qui reprend les contributions de groupe des comptes supprimés.
export const SYSTEM_EMAIL = "membre-supprime@system.invalid";

export async function ensureSystemUser(): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    create: {
      email: SYSTEM_EMAIL,
      prenom: "Membre supprimé",
      // Hash invalide : aucune connexion possible, même en devinant un mot de passe.
      passwordHash: "!system-account",
      isSystem: true,
      suspendedAt: new Date(0),
      suspendedReason: "Compte système",
    },
    update: {},
    select: { id: true },
  });
  return u.id;
}

// Fichiers PERSONNELS à effacer du disque (la base les supprime en cascade, pas le disque).
export async function personalFiles(userId: string): Promise<string[]> {
  const [roadbooks, licences, parcours] = await Promise.all([
    prisma.roadbook.findMany({ where: { userId }, select: { filePath: true } }),
    prisma.licenseDocument.findMany({ where: { userId }, select: { filePath: true } }),
    prisma.parcours.findMany({ where: { brmEvent: { userId } }, select: { filePath: true } }),
  ]);
  return [...roadbooks, ...licences, ...parcours].map((r) => r.filePath).filter((p): p is string => Boolean(p));
}

// Anonymisation : les contributions utiles au groupe (messages, conversations, traces des
// BRM, tracés PBP, points de contrôle) passent au compte « Membre supprimé » ; tout le
// reste (profil, licence, roadbooks, Strava, BRM perso, sessions…) part avec le compte.
// Renvoie les opérations à exécuter dans UNE transaction avec l'entrée d'audit.
export function anonymizeAndDeleteOps(userId: string, systemId: string) {
  return [
    prisma.groupMessage.updateMany({ where: { userId }, data: { userId: systemId } }),
    prisma.directMessage.updateMany({ where: { senderId: userId }, data: { senderId: systemId } }),
    prisma.directMessage.updateMany({ where: { recipientId: userId }, data: { recipientId: systemId } }),
    prisma.catalogTrack.updateMany({ where: { uploadedByUserId: userId }, data: { uploadedByUserId: systemId } }),
    prisma.catalogTrackVariant.updateMany({ where: { uploadedByUserId: userId }, data: { uploadedByUserId: systemId } }),
    prisma.catalogControlPoint.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: systemId } }),
    prisma.pbpRoute.updateMany({ where: { uploadedByUserId: userId }, data: { uploadedByUserId: systemId } }),
    prisma.user.delete({ where: { id: userId } }),
  ];
}

// Avant la suppression : révoque l'accès Strava chez Strava (sinon l'application garderait
// l'autorisation). Jamais bloquant.
export async function revokeExternalAccess(userId: string): Promise<void> {
  await disconnectStrava(userId).catch(() => undefined);
}

export async function removeFiles(paths: string[]): Promise<void> {
  for (const p of paths) await deleteUploadedFile(p).catch(() => undefined);
}
