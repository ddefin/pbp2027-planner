import type { Overview, Page, Period, UserDetail, UserRow } from "./types";

// Client de l'API /api/admin. Le navigateur envoie seul l'en-tête Origin, vérifié par le
// serveur sur chaque modification (protection CSRF en plus du cookie SameSite=Strict).

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, public fields: { path: string; message: string }[] = []) {
    super(code);
  }
}

export async function adminRequest<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/admin${path}`, {
    ...rest,
    credentials: "include",
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminApiError(res.status, body.error ?? "unknown_error", body.fields ?? []);
  return body as T;
}

// Messages lisibles pour les codes d'erreur du serveur.
export const ERROR_TEXT: Record<string, string> = {
  unauthenticated: "Ta session a expiré : reconnecte-toi.",
  forbidden: "Action réservée aux administrateurs.",
  bad_origin: "Requête refusée (origine inattendue). Recharge la page.",
  too_many_requests: "Trop d'actions en peu de temps : patiente quelques minutes.",
  wrong_password: "Mot de passe incorrect.",
  confirmation_mismatch: "L'adresse saisie ne correspond pas au compte.",
  cannot_target_self: "Impossible de faire cette action sur ton propre compte.",
  last_admin: "Il doit rester au moins un administrateur actif.",
  not_found: "Élément introuvable (déjà supprimé ?).",
  invalid_input: "Données invalides.",
};

export function errorText(err: unknown): string {
  if (err instanceof AdminApiError) return err.fields[0]?.message && err.code === "invalid_input" ? err.fields[0].message : (ERROR_TEXT[err.code] ?? "Une erreur est survenue.");
  return "Réseau indisponible : réessaie.";
}

export interface SearchResult {
  users: { id: string; prenom: string; email: string; isAdmin: boolean; suspended: boolean }[];
  pbpRoutes: { id: string; label: string; kind: string }[];
}

export const searchAdmin = (q: string) => adminRequest<SearchResult>(`/search?q=${encodeURIComponent(q)}`);


export const getOverview = (period: Period) => adminRequest<Overview>(`/overview?period=${period}`);
export const listUsers = (params: URLSearchParams) => adminRequest<Page<UserRow>>(`/users?${params}`);
export const getUser = (id: string) => adminRequest<UserDetail>(`/users/${encodeURIComponent(id)}`);
export const suspendUser = (id: string, reason: string) => adminRequest<{ ok: true }>(`/users/${encodeURIComponent(id)}/suspend`, { method: "POST", json: { reason } });
export const unsuspendUser = (id: string) => adminRequest<{ ok: true }>(`/users/${encodeURIComponent(id)}/unsuspend`, { method: "POST", json: {} });
export const setRole = (id: string, isAdmin: boolean, password: string) => adminRequest<{ ok: true }>(`/users/${encodeURIComponent(id)}/role`, { method: "POST", json: { isAdmin, password } });
export const deleteUser = (id: string, confirmEmail: string, password: string) => adminRequest<{ ok: true }>(`/users/${encodeURIComponent(id)}/delete`, { method: "POST", json: { confirmEmail, password } });
export const bulkUsers = (action: "suspend" | "unsuspend", ids: string[], reason?: string) =>
  adminRequest<{ results: { id: string; ok: boolean; error?: string }[] }>("/users/bulk", { method: "POST", json: { action, ids, ...(reason ? { reason } : {}) } });
