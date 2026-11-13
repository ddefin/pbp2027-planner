import { ApiError } from "./auth";

export interface CatalogParticipant {
  displayName: string;
  status: string;
  // Identifiant opaque et stable (distingue deux homonymes) ; jamais l'email ni l'id.
  memberKey: string;
  mine: boolean;
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

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number | null;
  distKm: number;
}

export interface CatalogTrack {
  fileName: string;
  points: TrackPoint[];
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

export async function getCatalogTrack(id: string): Promise<CatalogTrack | null> {
  try {
    const res = await request<{ track: CatalogTrack }>(`/brm/catalog/${id}/track`);
    return res.track;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function uploadCatalogTrack(id: string, file: File): Promise<CatalogTrack> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/brm/catalog/${id}/track`, { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return (body as { track: CatalogTrack }).track;
}

export function deleteCatalogTrack(id: string) {
  return request<void>(`/brm/catalog/${id}/track`, { method: "DELETE" });
}

export type ControlPointKind = "depart" | "ravito" | "controle" | "arrivee";

export interface ControlPoint {
  id: string;
  kind: ControlPointKind;
  label: string;
  lat: number;
  lon: number;
  mine: boolean;
}

export async function listControlPoints(id: string): Promise<ControlPoint[]> {
  const res = await request<{ points: ControlPoint[] }>(`/brm/catalog/${id}/control-points`);
  return res.points;
}

export async function createControlPoint(
  id: string,
  data: { kind: ControlPointKind; label: string; lat: number; lon: number },
): Promise<ControlPoint> {
  const res = await request<{ point: ControlPoint }>(`/brm/catalog/${id}/control-points`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.point;
}

export function deleteControlPoint(id: string, pointId: string) {
  return request<void>(`/brm/catalog/${id}/control-points/${pointId}`, { method: "DELETE" });
}

export interface TrackVariant {
  id: string;
  label: string;
  fileName: string;
  points: TrackPoint[];
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  uploadedBy: string;
  mine: boolean;
}

export async function listTrackVariants(id: string): Promise<TrackVariant[]> {
  const res = await request<{ variants: TrackVariant[] }>(`/brm/catalog/${id}/track-variants`);
  return res.variants;
}

export async function uploadTrackVariant(id: string, file: File, label: string): Promise<TrackVariant> {
  const form = new FormData();
  form.append("file", file);
  form.append("label", label);
  const res = await fetch(`/api/brm/catalog/${id}/track-variants`, { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return (body as { variant: TrackVariant }).variant;
}

export function deleteTrackVariant(id: string, variantId: string) {
  return request<void>(`/brm/catalog/${id}/track-variants/${variantId}`, { method: "DELETE" });
}

export interface Qualification {
  total: number;
  steps: { step: number; done: boolean; by: { distance: number; date: string; lieu: string; source: "perso" | "calendrier" } | null }[];
  catalogAvailable: boolean;
}

export function getQualification() {
  return request<Qualification>("/brm/qualification");
}
