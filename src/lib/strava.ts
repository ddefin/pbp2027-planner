import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "./secretCrypto.js";
import { estimateLoad, estimateZone, type AthleteSettings } from "./stravaMetrics.js";

const OAUTH = "https://www.strava.com/oauth";
const API = "https://www.strava.com/api/v3";
export const STRAVA_SCOPES = "read,activity:read_all,profile:read_all";
const HISTORY_DAYS = 400; // de quoi calculer l'année en cours et la forme (42 j) en début d'année
const MAX_PAGES = 6;
const REFRESH_MARGIN_MS = 5 * 60_000;
const SYNC_COOLDOWN_MS = 60_000;

export const stravaConfigured = () => Boolean(config.stravaClientId && config.stravaClientSecret);

export function redirectUri(): string | null {
  if (config.stravaRedirectUri) return config.stravaRedirectUri;
  return config.publicUrl ? `${config.publicUrl.replace(/\/$/, "")}/api/strava/callback` : null;
}

// ─── État OAuth : jeton signé (le cookie de session est « strict », il n'accompagne pas le
// retour depuis strava.com ; c'est donc le `state` qui identifie le compte, et il ne peut
// être ni forgé ni rejoué après 10 minutes) ───

function sign(payload: string): string {
  return createHmac("sha256", config.mfaEncryptionKeyHex).update(`strava-state:${payload}`).digest("base64url");
}

export function makeState(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + 10 * 60_000}.${randomBytes(6).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string, now = Date.now()): string | null {
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const payload = state.slice(0, i);
  const given = Buffer.from(state.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [userId, exp] = payload.split(".");
  return Number(exp) > now ? userId : null;
}

export function authorizeUrl(userId: string): string | null {
  const redirect = redirectUri();
  if (!stravaConfigured() || !redirect) return null;
  const q = new URLSearchParams({
    client_id: config.stravaClientId!,
    redirect_uri: redirect,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES,
    state: makeState(userId),
  });
  return `${OAUTH}/authorize?${q}`;
}

// ─── Jetons ───

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch secondes
  athlete?: { id: number; firstname?: string; lastname?: string; profile?: string };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.stravaClientId!, client_secret: config.stravaClientSecret!, ...params }),
  });
  if (!res.ok) {
    // Application pas encore autorisée pour plus d'un sportif : Strava refuse l'échange
    // pour les comptes au-delà de la capacité (403 / message « limit … exceeded »).
    const text = await res.text().catch(() => "");
    const limit = res.status === 403 || /limit|exceed|capacity/i.test(text);
    throw new StravaError(`Strava a refusé l'échange de jeton (HTTP ${res.status})`, res.status, limit ? "athlete_limit" : undefined);
  }
  return (await res.json()) as TokenResponse;
}

export class StravaError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: "authorization_code" });

// Jeton d'accès valide : renouvelé automatiquement quand il expire dans moins de 5 min
// (durée de vie 6 h). Strava peut renvoyer un NOUVEAU refresh_token : toujours stocker le dernier.
export async function validAccessToken(userId: string, now = Date.now()): Promise<string> {
  const acc = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!acc) throw new StravaError("Compte Strava non lié", 404);
  if (acc.expiresAt.getTime() - now > REFRESH_MARGIN_MS) return decryptSecret(acc.accessToken);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(acc.refreshToken) }).catch(async (err) => {
    if (err instanceof StravaError && (err.status === 400 || err.status === 401)) {
      // Autorisation retirée côté Strava : on le note, le sportif devra se reconnecter.
      await prisma.stravaAccount.update({ where: { userId }, data: { lastSyncError: "Autorisation Strava expirée ou révoquée : reconnecte ton compte." } });
    }
    throw err;
  });
  await prisma.stravaAccount.update({
    where: { userId },
    data: { accessToken: encryptSecret(t.access_token), refreshToken: encryptSecret(t.refresh_token), expiresAt: new Date(t.expires_at * 1000) },
  });
  return t.access_token;
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new StravaError("Limite de requêtes Strava atteinte : réessaie dans quelques minutes.", 429);
  if (!res.ok) throw new StravaError(`Strava a répondu HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

// ─── Connexion / déconnexion ───

export async function saveConnection(userId: string, t: TokenResponse, scope: string): Promise<void> {
  const a = t.athlete;
  const data = {
    athleteId: String(a?.id ?? ""),
    athleteName: [a?.firstname, a?.lastname].filter(Boolean).join(" ") || "Sportif Strava",
    profilePhoto: a?.profile && a.profile.startsWith("http") ? a.profile : null,
    accessToken: encryptSecret(t.access_token),
    refreshToken: encryptSecret(t.refresh_token),
    expiresAt: new Date(t.expires_at * 1000),
    scope,
    lastSyncError: null,
  };
  // Un compte Strava ne peut être lié qu'à un seul compte de l'app.
  await prisma.stravaAccount.deleteMany({ where: { athleteId: data.athleteId, NOT: { userId } } });
  await prisma.stravaAccount.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

// Révocation propre : POST /oauth/deauthorize invalide le jeton côté Strava, puis on efface
// tout ce qui vient de Strava (jetons, activités). Même si Strava est injoignable, les
// données locales sont supprimées (le droit à l'effacement prime).
export async function disconnect(userId: string): Promise<{ revoked: boolean }> {
  let revoked = false;
  try {
    const token = await validAccessToken(userId);
    const res = await fetch(`${OAUTH}/deauthorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: token }),
    });
    revoked = res.ok;
  } catch {
    revoked = false;
  }
  await purgeLocal(userId);
  return { revoked };
}

export async function purgeLocal(userId: string): Promise<void> {
  await prisma.stravaActivity.deleteMany({ where: { userId } });
  await prisma.stravaAccount.deleteMany({ where: { userId } });
}

// ─── Synchronisation ───

interface StravaSummary {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  average_speed?: number;
  trainer?: boolean;
}

const isRide = (a: StravaSummary) => /ride/i.test(a.sport_type ?? a.type ?? "");

function settingsOf(acc: { ftp: number | null; maxHr: number | null; hrZones: string | null }): AthleteSettings {
  return { ftp: acc.ftp, maxHr: acc.maxHr, hrZones: acc.hrZones ? (JSON.parse(acc.hrZones) as [number, number][]) : null };
}

function activityUpsert(userId: string, a: StravaSummary, settings: AthleteSettings) {
  const inp = { movingSec: a.moving_time, avgHr: a.average_heartrate ?? null, avgWatts: a.average_watts ?? null, weightedWatts: a.weighted_average_watts ?? null };
  const data = {
    userId,
    name: a.name.slice(0, 200),
    sportType: a.sport_type ?? a.type ?? "Ride",
    startDate: new Date(a.start_date),
    startLocal: new Date(a.start_date_local),
    distanceM: a.distance,
    movingSec: a.moving_time,
    elevationM: a.total_elevation_gain ?? 0,
    avgHr: inp.avgHr,
    maxHr: a.max_heartrate ?? null,
    avgWatts: inp.avgWatts,
    weightedWatts: inp.weightedWatts,
    avgSpeedMs: a.average_speed ?? null,
    load: estimateLoad(inp, settings),
    zone: estimateZone(inp, settings),
  };
  return prisma.stravaActivity.upsert({ where: { id: String(a.id) }, create: { id: String(a.id), ...data }, update: data });
}

// Écriture groupée : UNE transaction par lot de 100 sorties. Une écriture par sortie
// coûtait une synchronisation disque chacune (plusieurs secondes sur le disque d'un NAS
// pour une année d'activités).
async function saveActivities(userId: string, rides: StravaSummary[], settings: AthleteSettings): Promise<void> {
  for (let i = 0; i < rides.length; i += 100) {
    await prisma.$transaction(rides.slice(i, i + 100).map((a) => activityUpsert(userId, a, settings)));
  }
}

async function refreshAthlete(userId: string, token: string, batchMaxHr = 0): Promise<AthleteSettings> {
  const [athlete, zones] = await Promise.all([
    api<{ ftp?: number | null; profile?: string; firstname?: string; lastname?: string }>(token, "/athlete").catch(() => null),
    api<{ heart_rate?: { zones?: { min: number; max: number }[] } }>(token, "/athlete/zones").catch(() => null),
  ]);
  const hz = zones?.heart_rate?.zones?.map((z) => [z.min, z.max] as [number, number]) ?? null;
  const observed = await prisma.stravaActivity.aggregate({ where: { userId }, _max: { maxHr: true } });
  const maxHr = Math.round(Math.max(observed._max.maxHr ?? 0, batchMaxHr, hz?.[hz.length - 1]?.[0] ?? 0)) || null;
  await prisma.stravaAccount.update({
    where: { userId },
    data: {
      ftp: athlete?.ftp ?? null,
      maxHr,
      hrZones: hz ? JSON.stringify(hz) : null,
      ...(athlete?.profile?.startsWith("http") ? { profilePhoto: athlete.profile } : {}),
      ...(athlete?.firstname ? { athleteName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") } : {}),
    },
  });
  return { ftp: athlete?.ftp ?? null, maxHr, hrZones: hz };
}

// Comptes en cours de synchronisation (une seule instance du serveur) : l'interface s'en
// sert pour savoir s'il faut encore attendre des données.
const syncing = new Set<string>();
export const isSyncing = (userId: string) => syncing.has(userId);

// Synchronisation des `days` derniers jours (par défaut tout l'historique utile). Cooldown
// d'une minute (bouton « Synchroniser » martelé) sauf `force`. Jamais d'exception :
// l'erreur est mémorisée sur le compte pour être affichée.
export async function syncAccount(userId: string, opts: { force?: boolean; now?: Date; days?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string; throttled?: boolean }> {
  const now = opts.now ?? new Date();
  const acc = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!acc) return { ok: false, synced: 0, error: "Compte Strava non lié" };
  if (!opts.force && acc.lastSyncAt && now.getTime() - acc.lastSyncAt.getTime() < SYNC_COOLDOWN_MS) return { ok: true, synced: 0, throttled: true };
  syncing.add(userId);
  try {
    const token = await validAccessToken(userId, now.getTime());
    const after = Math.floor((now.getTime() - (opts.days ?? HISTORY_DAYS) * 86_400_000) / 1000);
    const page = (n: number) => api<StravaSummary[]>(token, `/athlete/activities?after=${after}&per_page=200&page=${n}`);
    const all: StravaSummary[] = [...(await page(1))];
    for (let n = 2; n <= MAX_PAGES && all.length === (n - 1) * 200; n++) all.push(...(await page(n)));
    const rides = all.filter(isRide);
    const settings = await refreshAthlete(userId, token, Math.max(0, ...rides.map((r) => r.max_heartrate ?? 0)));
    await saveActivities(userId, rides, settings);
    await prisma.stravaAccount.update({ where: { userId }, data: { lastSyncAt: now, lastSyncError: null } });
    return { ok: true, synced: rides.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    await prisma.stravaAccount.update({ where: { userId }, data: { lastSyncAt: now, lastSyncError: message } }).catch(() => undefined);
    return { ok: false, synced: 0, error: message };
  } finally {
    syncing.delete(userId);
  }
}

// À la connexion : d'abord les 8 dernières semaines (une seule requête, le tableau de bord
// s'affiche en une à deux secondes), puis tout l'historique en arrière-plan.
export async function initialSync(userId: string): Promise<void> {
  syncing.add(userId);
  try {
    const quick = await syncAccount(userId, { force: true, days: 60 });
    syncing.add(userId); // reste « en cours » entre les deux passes
    if (quick.ok) await syncAccount(userId, { force: true });
  } finally {
    syncing.delete(userId);
  }
}

// Webhook : une activité créée/modifiée est relue seule (1 requête), une supprimée est effacée.
export async function syncOneActivity(athleteId: string, activityId: string, aspect: "create" | "update" | "delete"): Promise<{ userId: string; created: boolean } | null> {
  const acc = await prisma.stravaAccount.findUnique({ where: { athleteId } });
  if (!acc) return null;
  if (aspect === "delete") {
    await prisma.stravaActivity.deleteMany({ where: { id: activityId, userId: acc.userId } });
    return { userId: acc.userId, created: false };
  }
  try {
    const token = await validAccessToken(acc.userId);
    const a = await api<StravaSummary>(token, `/activities/${activityId}`);
    if (!isRide(a)) return null;
    await activityUpsert(acc.userId, a, settingsOf(acc));
    return { userId: acc.userId, created: aspect === "create" };
  } catch (err) {
    console.error("[strava] activité non synchronisée :", err instanceof Error ? err.message : err);
    return null;
  }
}

// Synchronise tous les comptes (toutes les 6 h) : filet de sécurité si un webhook est manqué
// et renouvellement régulier des jetons.
export async function syncAllAccounts(): Promise<number> {
  if (!stravaConfigured()) return 0;
  const accounts = await prisma.stravaAccount.findMany({ select: { userId: true } });
  let ok = 0;
  for (const a of accounts) if ((await syncAccount(a.userId, { force: true })).ok) ok++;
  return ok;
}

export { settingsOf };

// ─── Abonnement webhook (une fois par application Strava) ───

export async function ensureWebhookSubscription(): Promise<"created" | "exists" | "skipped" | "error"> {
  const verify = config.stravaWebhookVerifyToken;
  const base = config.publicUrl;
  if (!stravaConfigured() || !verify || !base) return "skipped";
  const callback = `${base.replace(/\/$/, "")}/api/strava/webhook`;
  try {
    const q = new URLSearchParams({ client_id: config.stravaClientId!, client_secret: config.stravaClientSecret! });
    const list = await fetch(`${API}/push_subscriptions?${q}`);
    if (list.ok) {
      const subs = (await list.json()) as { callback_url: string }[];
      if (subs.some((s) => s.callback_url === callback)) return "exists";
    }
    const res = await fetch(`${API}/push_subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.stravaClientId!, client_secret: config.stravaClientSecret!, callback_url: callback, verify_token: verify }),
    });
    return res.ok ? "created" : "error";
  } catch {
    return "error";
  }
}
