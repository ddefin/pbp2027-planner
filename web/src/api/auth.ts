// Toutes les requêtes passent par des chemins relatifs (/auth/...) : même origine
// en dev (proxy Vite) comme en prod (reverse proxy), donc pas de CORS et le cookie
// de session httpOnly part normalement avec credentials: "include".

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "unknown_error");
  }
  return body as T;
}

export interface SessionInfo {
  email: string;
  mfaEnabled: boolean;
}

export type LoginResult = { status: "authenticated" } | { status: "mfa_required"; challengeToken: string };

export function register(email: string, password: string) {
  return request<{ status: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string) {
  return request<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function verifyMfa(challengeToken: string, code: string) {
  return request<{ status: "authenticated" }>("/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ challengeToken, code }),
  });
}

export function getSession() {
  return request<SessionInfo>("/auth/session");
}

export function logout() {
  return request<{ status: string }>("/auth/logout", { method: "POST" });
}

export function setupMfa() {
  return request<{ secret: string; otpauthUri: string }>("/auth/mfa/setup", { method: "POST" });
}

export function enableMfa(code: string) {
  return request<{ status: string; recoveryCodes: string[] }>("/auth/mfa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disableMfa() {
  return request<{ status: string }>("/auth/mfa/disable", { method: "POST" });
}

export function revokeOtherSessions() {
  return request<{ status: string }>("/auth/sessions/revoke-others", { method: "POST" });
}
