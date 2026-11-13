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
  sort: z.enum(USER_SORT).optional().default("createdAt"),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export type UserListQuery = z.infer<typeof userListQuery>;

export const PERIODS = ["7d", "30d", "12m"] as const;
export const periodQuery = z.object({ period: z.enum(PERIODS).optional().default("30d") });
