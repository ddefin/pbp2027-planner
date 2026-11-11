import { ApiError } from "./auth";
import type { TrackPoint } from "./brmCatalog";
import type { RoadbookControl } from "../lib/roadbook";

export interface RoadbookPoi {
  name: string;
  km: number;
  lat: number;
  lon: number;
}

export interface RoadbookSettings {
  title: string;
  liveTrackUrl?: string | null;
  telegramAnnounce?: boolean;
  classKm: number;
  limitMinutes: number;
  startAt: string | null;
  movingSpeedKmh: number;
  climbPenaltyMinPer100m: number;
  controls: RoadbookControl[];
}

export interface AnnounceStatus {
  lastPublishedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  hint: string | null;
}

export interface Roadbook extends RoadbookSettings {
  id: string;
  announceStatus?: AnnounceStatus;
  pois: RoadbookPoi[];
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  fileName: string;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoadbookWithPoints extends Roadbook {
  points: TrackPoint[];
}

export interface Checkin {
  km: number;
  lat: number | null;
  lon: number | null;
  source: "gps" | "manuel" | "controle";
  at: string;
}

export interface SharedRoadbook extends Omit<RoadbookWithPoints, "id" | "shareToken" | "telegramAnnounce" | "announceStatus"> {
  author: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body !== undefined && !(init.body instanceof FormData) ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

type CompactPoint = [number, number, number | null, number];
const decode = (pts: CompactPoint[]): TrackPoint[] => pts.map(([lat, lon, ele, distKm]) => ({ lat, lon, ele, distKm }));

export function listRoadbooks() {
  return request<{ roadbooks: Roadbook[] }>("/roadbooks").then((r) => r.roadbooks);
}

export function uploadRoadbook(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ roadbook: Roadbook }>("/roadbooks", { method: "POST", body: form }).then((r) => r.roadbook);
}

export async function getRoadbook(id: string): Promise<{ roadbook: RoadbookWithPoints; checkins: Checkin[] }> {
  const raw = await request<{ roadbook: Roadbook & { points: CompactPoint[] }; checkins: Checkin[] }>(`/roadbooks/${id}`);
  return { roadbook: { ...raw.roadbook, points: decode(raw.roadbook.points) }, checkins: raw.checkins };
}

export function updateRoadbook(id: string, settings: Partial<RoadbookSettings>) {
  return request<{ roadbook: Roadbook }>(`/roadbooks/${id}`, { method: "PATCH", body: JSON.stringify(settings) }).then((r) => r.roadbook);
}

export function deleteRoadbook(id: string) {
  return request<void>(`/roadbooks/${id}`, { method: "DELETE" });
}

export function setRoadbookSharing(id: string, enabled: boolean) {
  return request<{ shareToken: string | null }>(`/roadbooks/${id}/share`, { method: "POST", body: JSON.stringify({ enabled }) }).then((r) => r.shareToken);
}

export function postCheckin(id: string, input: { km: number; lat?: number | null; lon?: number | null; source: Checkin["source"] }) {
  return request<{ checkin: Checkin }>(`/roadbooks/${id}/checkins`, { method: "POST", body: JSON.stringify(input) }).then((r) => r.checkin);
}

export function resetCheckins(id: string) {
  return request<void>(`/roadbooks/${id}/checkins`, { method: "DELETE" });
}

export function roadbookGpxUrl(id: string) {
  return `/api/roadbooks/${id}/gpx`;
}

export async function getSharedRoadbook(token: string): Promise<{ roadbook: SharedRoadbook; checkins: Checkin[] }> {
  const raw = await request<{ roadbook: SharedRoadbook & { points: CompactPoint[] }; checkins: Checkin[] }>(`/roadbooks/shared/${encodeURIComponent(token)}`);
  return { roadbook: { ...raw.roadbook, points: decode(raw.roadbook.points as unknown as CompactPoint[]) }, checkins: raw.checkins };
}

export function testTrackingChannel() {
  return request<{
    ok: boolean;
    chatId: string | null;
    usingFallback: boolean;
    error?: string;
    hint?: string;
    knownChats: { chatId: string; title: string; type: string; botStatus: string | null }[];
  }>("/roadbooks/telegram/test", { method: "POST" });
}

export function getRoadbookSituation(id: string) {
  return request<{ whatsapp: string; at: string }>(`/roadbooks/${id}/situation`);
}

export function getSharedSituation(token: string) {
  return request<{ whatsapp: string; at: string }>(`/roadbooks/shared/${encodeURIComponent(token)}/situation`);
}
