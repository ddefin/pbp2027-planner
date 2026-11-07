import { ApiError } from "./auth";

export interface Sortie {
  id: string;
  titre: string;
  date: string;
  lieu: string;
  createdBy: string;
  participants: string[];
  joined: boolean;
}

export interface ChatMessage {
  id: string;
  who: string;
  text: string;
  createdAt: string;
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

export function listSorties() {
  return request<{ sorties: Sortie[] }>("/sorties").then((r) => r.sorties);
}

export function createSortie(input: { titre: string; date: string; lieu: string }) {
  return request<{ sortie: Sortie }>("/sorties", { method: "POST", body: JSON.stringify(input) }).then((r) => r.sortie);
}

export function joinSortie(id: string) {
  return request<{ status: string }>(`/sorties/${id}/join`, { method: "POST" });
}

export function leaveSortie(id: string) {
  return request<void>(`/sorties/${id}/join`, { method: "DELETE" });
}

export function listMessages(id: string) {
  return request<{ messages: ChatMessage[] }>(`/sorties/${id}/messages`).then((r) => r.messages);
}

export function chatSocketUrl(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/sorties/${id}/chat`;
}
