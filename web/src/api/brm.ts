import { ApiError } from "./auth";

export type BrmDistance = 200 | 300 | 400 | 600;
export type BrmStatus = "a-venir" | "inscrit" | "fait" | "homologue";

export interface BrmEvent {
  id: string;
  distance: BrmDistance;
  date: string;
  lieu: string;
  status: BrmStatus;
  limiteMinutes: number;
  tempsRealiseMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBrmInput {
  distance: BrmDistance;
  date: string;
  lieu: string;
  status?: BrmStatus;
  limiteMinutes?: number;
}

export interface UpdateBrmInput {
  distance?: BrmDistance;
  date?: string;
  lieu?: string;
  status?: BrmStatus;
  limiteMinutes?: number;
  tempsRealiseMinutes?: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export function listBrmEvents() {
  return request<{ events: BrmEvent[] }>("/brm").then((r) => r.events);
}

export function createBrmEvent(input: CreateBrmInput) {
  return request<{ event: BrmEvent }>("/brm", { method: "POST", body: JSON.stringify(input) }).then((r) => r.event);
}

export function updateBrmEvent(id: string, input: UpdateBrmInput) {
  return request<{ event: BrmEvent }>(`/brm/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
    (r) => r.event,
  );
}

export function deleteBrmEvent(id: string) {
  return request<void>(`/brm/${id}`, { method: "DELETE" });
}
