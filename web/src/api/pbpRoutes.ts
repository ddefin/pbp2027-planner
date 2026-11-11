import { ApiError } from "./auth";
import type { TrackPoint } from "./brmCatalog";

export type RouteKind = "officiel" | "provisoire" | "communautaire" | "indicatif";

export interface PbpRouteMeta {
  id: string;
  label: string;
  kind: RouteKind;
  description: string | null;
  fileName: string;
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  rawPointCount: number;
  uploadedBy: string | null;
  createdAt: string;
  canDelete: boolean;
}

export type ControlService = "controle" | "restauration" | "douches" | "couchage" | "mecanique";

export interface PbpControl {
  step: number;
  name: string;
  lat: number;
  lon: number;
  officialKm: number | null;
  services: ControlService[];
  note?: string;
  km: number | null;
  offsetKm: number | null;
}

export interface RouteWaypoint {
  name: string;
  lat: number;
  lon: number;
  km: number;
  offsetKm: number;
}

export interface PbpRouteDetail {
  points: TrackPoint[];
  waypoints: RouteWaypoint[];
  controls: PbpControl[];
}

export interface DepartureWave {
  id: string;
  label: string;
  start: string;
  limitHours: number;
}

export interface PbpMeta {
  waves: DepartureWave[];
  totalKm: number;
  weatherConfigured: boolean;
}

export type WindRelation = "dos" | "face" | "travers";
export type WeatherAlert = "vent_fort" | "vent_de_face" | "pluie" | "froid" | "chaleur";

export interface WeatherSlot {
  at: string;
  tempC: number;
  feelsLikeC: number;
  description: string;
  icon: string;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  windFromDeg: number | null;
  precipitationProbability: number;
  rainMm: number;
}

export interface RouteWeatherSample {
  km: number;
  lat: number;
  lon: number;
  label: string;
  isControl: boolean;
  eta: string;
  routeBearingDeg: number;
  forecast: (WeatherSlot & { windRelation: WindRelation | null; alongWindKmh: number | null }) | null;
  outOfRange: boolean;
  alerts: WeatherAlert[];
}

export interface RouteWeather {
  samples: RouteWeatherSample[];
  horizonEnd: string | null;
  configured: boolean;
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

export function getPbpMeta() {
  return request<PbpMeta>("/pbp/meta");
}

export function listPbpRoutes() {
  return request<{ routes: PbpRouteMeta[]; defaultId: string }>("/pbp/routes");
}

type CompactPoint = [number, number, number | null, number];

export async function getPbpRoute(id: string): Promise<PbpRouteDetail> {
  const raw = await request<{ points: CompactPoint[]; waypoints: RouteWaypoint[]; controls: PbpControl[] }>(`/pbp/routes/${encodeURIComponent(id)}`);
  return { ...raw, points: raw.points.map(([lat, lon, ele, distKm]) => ({ lat, lon, ele, distKm })) };
}

export function uploadPbpRoute(input: { file: File; label: string; kind: RouteKind; description?: string }) {
  // Champs texte AVANT le fichier : le serveur ne connaît que ceux-là au moment où il
  // lit le fichier (voir src/routes/pbpRoutes.ts).
  const form = new FormData();
  form.append("label", input.label);
  form.append("kind", input.kind);
  if (input.description) form.append("description", input.description);
  form.append("file", input.file);
  return request<{ route: PbpRouteMeta; simplifiedPointCount: number }>("/pbp/routes", { method: "POST", body: form });
}

export function updatePbpRoute(id: string, input: { label?: string; kind?: RouteKind; description?: string | null }) {
  return request<{ route: PbpRouteMeta }>(`/pbp/routes/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((r) => r.route);
}

export function deletePbpRoute(id: string) {
  return request<void>(`/pbp/routes/${id}`, { method: "DELETE" });
}

export function pbpRouteGpxUrl(id: string) {
  return `/api/pbp/routes/${id}/gpx`;
}

export function getRouteWeather(id: string, params: { start: string; speed: number; step?: number }) {
  const q = new URLSearchParams({ start: params.start, speed: String(params.speed), step: String(params.step ?? 60) });
  return request<RouteWeather>(`/pbp/routes/${encodeURIComponent(id)}/weather?${q}`);
}

export function getPointWeather(lat: number, lon: number) {
  return request<{ place: string; slots: WeatherSlot[] }>(`/pbp/weather/point?lat=${lat}&lon=${lon}`);
}
