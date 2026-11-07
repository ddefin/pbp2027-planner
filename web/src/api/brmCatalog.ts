import { ApiError } from "./auth";

export interface CatalogParticipant {
  displayName: string;
  status: string;
}

export interface CatalogEvent {
  id: string;
  date: string; // yyyy-mm-dd
  distance: number;
  ville: string;
  departement: string;
  region: string;
  club: string;
  contact: string;
  siteWeb: string;
  roadMap: string;
  denivele: number;
  participants: CatalogParticipant[];
  myStatus: string | null;
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

export function listCatalog() {
  return request<{ events: CatalogEvent[]; window: { from: string; to: string } }>("/brm/catalog");
}

export function setParticipation(id: string, status: string) {
  return request<{ status: string }>(`/brm/catalog/${id}/participation`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export function clearParticipation(id: string) {
  return request<void>(`/brm/catalog/${id}/participation`, { method: "DELETE" });
}
