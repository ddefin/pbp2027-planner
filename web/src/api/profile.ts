import { ApiError } from "./auth";

export interface Profile {
  email: string;
  prenom: string;
  licenceNumero: string | null;
  club: string | null;
  notebook: string | null;
}

export interface PersonalEvent {
  id: string;
  title: string;
  date: string; // ISO
  notes: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export function getProfile() {
  return request<Profile>("/profile");
}

export function updateProfile(data: Partial<Pick<Profile, "prenom" | "licenceNumero" | "club" | "notebook">>) {
  return request<Profile>("/profile", { method: "PATCH", body: JSON.stringify(data) });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ status: string }>("/profile/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function listPersonalEvents() {
  return request<{ events: PersonalEvent[] }>("/profile/events").then((r) => r.events);
}

export function createPersonalEvent(data: { title: string; date: string; notes?: string | null }) {
  return request<{ event: PersonalEvent }>("/profile/events", { method: "POST", body: JSON.stringify(data) }).then(
    (r) => r.event,
  );
}

export function deletePersonalEvent(id: string) {
  return request<void>(`/profile/events/${id}`, { method: "DELETE" });
}
