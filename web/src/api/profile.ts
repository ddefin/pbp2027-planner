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

export interface LicenseDocument {
  id: string;
  fileName: string;
  fileMimeType: string;
  createdAt: string; // ISO
}

export function listLicenseDocuments() {
  return request<{ documents: LicenseDocument[] }>("/profile/license").then((r) => r.documents);
}

export async function uploadLicenseDocument(file: File): Promise<LicenseDocument> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/profile/license", { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return (body as { document: LicenseDocument }).document;
}

export function licenseFileUrl(id: string) {
  return `/api/profile/license/${id}/file`;
}

export function deleteLicenseDocument(id: string) {
  return request<void>(`/profile/license/${id}`, { method: "DELETE" });
}

export interface TelegramStatus {
  linked: boolean;
  linkedAt: string | null;
  configured: boolean;
  botUsername: string | null;
}

export function getTelegramStatus() {
  return request<TelegramStatus>("/profile/telegram");
}

export function createTelegramLinkCode() {
  return request<{ code: string; expiresAt: string }>("/profile/telegram/link-code", { method: "POST" });
}

export function unlinkTelegram() {
  return request<void>("/profile/telegram", { method: "DELETE" });
}
