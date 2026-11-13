import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getSessionUser } from "./session.js";
import { checkRateLimit, isRateLimited } from "./rateLimit.js";
import { verifyPassword } from "./password.js";

export type AdminUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Défense en profondeur contre le CSRF (le cookie de session est déjà SameSite=Strict) :
// une modification doit venir du site lui-même. Un navigateur envoie toujours Origin
// et/ou Sec-Fetch-Site sur une requête de modification ; un client sans navigateur
// (tests, scripts) n'en envoie pas et n'a pas de cookie volé à exploiter.
export function sameOrigin(request: FastifyRequest): boolean {
  const site = request.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = new Set<string>();
  if (config.publicUrl) {
    try {
      allowed.add(new URL(config.publicUrl).origin);
    } catch {
      /* PUBLIC_URL mal formée : on retombe sur l'hôte de la requête */
    }
  }
  if (request.headers.host) allowed.add(`${request.protocol}://${request.headers.host}`);
  return allowed.has(origin);
}

// Garde appliquée à TOUT le préfixe /api/admin (voir src/routes/admin/index.ts) :
// session valide, rôle ADMIN, origine du site et débit limité pour les modifications.
export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(request);
  if (!user) return reply.code(401).send({ error: "unauthenticated" });
  if (!user.isAdmin) return reply.code(403).send({ error: "forbidden" });
  if (MUTATING.has(request.method)) {
    if (!sameOrigin(request)) return reply.code(403).send({ error: "bad_origin" });
    const rl = checkRateLimit(`admin-mutation:${user.id}`, 30, 60_000);
    if (!rl.allowed) return reply.code(429).send({ error: "too_many_requests" });
  }
  request.adminUser = user;
}

export class AdminError extends Error {
  constructor(public statusCode: number, public code: string) {
    super(code);
  }
}

// Deuxième vérification, DANS chaque route : si la garde globale venait à être retirée
// par erreur, aucune route admin ne s'exécuterait sans administrateur.
export function actorOf(request: FastifyRequest): AdminUser {
  const a = request.adminUser;
  if (!a || !a.isAdmin) throw new AdminError(403, "forbidden");
  return a;
}

// Ré-authentification pour les actions sensibles (suppression, changement de rôle).
export async function confirmPassword(actor: AdminUser, password: unknown): Promise<void> {
  // Seuls les ÉCHECS comptent : 5 mots de passe erronés en 15 min bloquent les actions
  // sensibles de cet administrateur.
  const key = `admin-reauth:${actor.id}`;
  if (isRateLimited(key, 5)) throw new AdminError(429, "too_many_requests");
  if (typeof password !== "string" || !password || !(await verifyPassword(password, actor.passwordHash))) {
    checkRateLimit(key, 5, 15 * 60_000);
    throw new AdminError(403, "wrong_password");
  }
}

// Suppressions : débit plus serré que les autres modifications.
export function limitDeletions(actor: AdminUser): void {
  if (!checkRateLimit(`admin-delete:${actor.id}`, 5, 10 * 60_000).allowed) throw new AdminError(429, "too_many_requests");
}
