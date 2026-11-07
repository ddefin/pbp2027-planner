import { ApiError } from "./auth";

export interface Parcours {
  id: string;
  brmEventId: string;
  sourceUrl: string | null;
  fileName: string | null;
  hasFile: boolean;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
  windDirection: string | null;
  windSpeedKmh: number | null;
  windGustsKmh: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  precipitation: string | null;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ParcoursUpdateInput {
  sourceUrl?: string | null;
  windDirection?: string | null;
  windSpeedKmh?: number | null;
  windGustsKmh?: number | null;
  tempMinC?: number | null;
  tempMaxC?: number | null;
  precipitation?: string | null;
  notes?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body !== undefined && !(init.body instanceof FormData)
      ? { "content-type": "application/json", ...init?.headers }
      : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export function getParcours(brmEventId: string) {
  return request<{ parcours: Parcours | null }>(`/brm/${brmEventId}/parcours`).then((r) => r.parcours);
}

export function updateParcours(brmEventId: string, input: ParcoursUpdateInput) {
  return request<{ parcours: Parcours; autoFetched: boolean }>(`/brm/${brmEventId}/parcours`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function uploadParcoursFile(brmEventId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/brm/${brmEventId}/parcours/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as { parcours: Parcours; statsParsed: boolean };
}

export function deleteParcoursFile(brmEventId: string) {
  return request<void>(`/brm/${brmEventId}/parcours/file`, { method: "DELETE" });
}

export function parcoursFileDownloadUrl(brmEventId: string): string {
  return `/api/brm/${brmEventId}/parcours/file`;
}
