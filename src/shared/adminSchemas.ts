import { z } from "zod";

// Schémas de validation de l'espace /admin, partagés entre le serveur (validation
// stricte) et l'interface (validation des formulaires avant envoi).

export const idParam = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) });

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(3, "3 caractères minimum")
    .max(max, `${max} caractères maximum`)
    // Pas de caractères de contrôle (sauts de ligne acceptés).
    .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), "Caractères invalides");

export const reasonSchema = z.object({ reason: cleanText(300) });

export const bulkSchema = z.object({
  action: z.enum(["suspend", "unsuspend"]),
  ids: z.array(idParam.shape.id).min(1).max(100),
  reason: cleanText(300).optional(),
});

export const roleSchema = z.object({ isAdmin: z.boolean(), password: z.string().min(1).max(200) });

export const deleteSchema = z.object({ confirmEmail: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });

export const USER_SORT = ["createdAt", "prenom", "email", "lastSeenAt"] as const;

export const userListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["all", "active", "suspended", "locked"]).optional().default("all"),
  role: z.enum(["all", "admin", "member"]).optional().default("all"),
  presence: z.enum(["all", "online", "recent", "away"]).optional().default("all"),
  sort: z.enum(USER_SORT).optional().default("createdAt"),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export type UserListQuery = z.infer<typeof userListQuery>;

export const PERIODS = ["7d", "30d", "12m"] as const;
export const periodQuery = z.object({ period: z.enum(PERIODS).optional().default("30d") });

export const listQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export const AUDIT_ACTIONS = ["user.suspend", "user.unsuspend", "user.promote", "user.demote", "user.delete", "user.reset_link", "content.delete", "announcement.send"] as const;
export const auditQuery = listQuery.extend({ action: z.enum(AUDIT_ACTIONS).optional() });

export const AUTH_KINDS = ["login_ok", "login_locked", "login_suspended", "reset_requested", "reset_no_account", "reset_suspended", "mail_sent", "mail_failed", "reset_ok", "reset_token_invalid"] as const;
export const authEventsQuery = listQuery.extend({ kind: z.enum(AUTH_KINDS).optional() });

// Suppression d'un contenu : motif obligatoire (il figure au journal d'audit).
export const contentDeleteSchema = z.object({ reason: z.string().trim().min(3, "3 caractères minimum").max(300, "300 caractères maximum") });

// Annonce au groupe : texte simple (pas de caractères de contrôle).
export const announcementSchema = z.object({
  message: z
    .string()
    .trim()
    .min(3, "3 caractères minimum")
    .max(500, "500 caractères maximum")
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), "Caractères invalides"),
  telegram: z.boolean().optional().default(false),
});
