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
  syncing?: boolean;
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

// ─── Records, défis brevets, trophées de segments ───

export interface RecordItem {
  key: string;
  label: string;
  value: number;
  unit: "km" | "m" | "h" | "km/h" | "jours";
  activityId: string | null;
  activityName: string | null;
  date: string | null;
  until?: string | null;
}

export interface Trophy {
  id: string;
  kind: "kom" | "top10" | "pr";
  rank: number;
  segmentId: string;
  segmentName: string;
  activityId: string;
  km: number;
  gradePct: number | null;
  climbCategory: number | null;
  city: string | null;
  elapsedSec: number;
  date: string;
}

export interface StravaRecords {
  records: RecordItem[];
  allTime: { biggestRideM: number | null; biggestClimbM: number | null; all: { count: number; distanceM: number; movingSec: number; elevationM: number } | null } | null;
  challenges: {
    steps: { km: number; done: boolean; activityId: string | null; date: string | null }[];
    rides200: number;
    best200: { kmh: number; activityId: string; name: string; date: string; km: number } | null;
    bestMonth: { month: string; km: number; pct: number } | null;
  };
  trophies: { kom: number; top10: number; prSeason: number; list: Trophy[] };
  segments: { analysed: number; total: number; syncing: boolean };
  history: { done: boolean; oldestLoaded: string | null; firstRideAt: string | null };
  empty: boolean;
}

export const getStravaRecords = () => request<StravaRecords>("/strava/records");
