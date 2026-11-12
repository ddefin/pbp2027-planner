import { ApiError } from "./auth";

export type Level = "ok" | "attention" | "alerte" | "info";
export type CoachProfile = "endurance" | "performance" | "forme";
export type CoachTone = "bienveillant" | "direct" | "technique";
export type CoachFrequency = "activite" | "hebdo" | "demande";
export type CoachMetric = "hr" | "power" | "elevation" | "speed";

export interface StravaStatus {
  configured: boolean;
  missing?: string[];
  redirectUri: string | null;
  mcpUrl: string;
  connected: boolean;
  account: {
    athleteName: string;
    profilePhoto: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    connectedAt: string;
    scopeOk: boolean;
    ftp: number | null;
    maxHr: number | null;
  } | null;
}

export interface Volume {
  km: number;
  hours: number;
  elevationM: number;
  rides: number;
  load: number;
}
export interface Insight {
  level: Level;
  title: string;
  text: string;
}
export interface Share {
  low: number;
  mid: number;
  high: number;
  coveredSeconds: number;
  totalSeconds: number;
}
export interface Dashboard {
  kpis: { d7: Volume; d30: Volume; year: Volume };
  fitness: { ctl: number; atl: number; tsb: number; acwr: number | null; acute: number; chronic: number };
  intensity: { week: Share; month: Share };
  weekly: (Volume & { weekStart: string })[];
  coach: {
    headline: { level: Level; text: string };
    diagnostics: Insight[];
    balance: Insight | null;
    metrics: Insight[];
    advice: string[];
  };
  recent: { at: string; km: number; hours: number; elevationM: number; load: number; zone: number | null }[];
  empty: boolean;
}
export interface CoachPrefs {
  profile: CoachProfile;
  tone: CoachTone;
  frequency: CoachFrequency;
  metrics: CoachMetric[];
  goal: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export const getStravaStatus = () => request<StravaStatus>("/strava/status");
export const getStravaConnectUrl = () => request<{ url: string }>("/strava/connect").then((r) => r.url);
export const syncStrava = () => request<{ ok: boolean; synced: number; error?: string; throttled?: boolean }>("/strava/sync", { method: "POST" });
export const disconnectStrava = () => request<{ revoked: boolean }>("/strava/disconnect", { method: "POST" });
export const getStravaDashboard = () => request<Dashboard>("/strava/dashboard");
export const getCoachPrefs = () => request<{ prefs: CoachPrefs }>("/strava/coach-prefs").then((r) => r.prefs);
export const saveCoachPrefs = (p: CoachPrefs) => request<{ ok: boolean }>("/strava/coach-prefs", { method: "PUT", body: JSON.stringify(p) });
export const testStravaMcp = () => request<{ reachable: boolean; status: number | null; message: string }>("/strava/mcp-test", { method: "POST" });
