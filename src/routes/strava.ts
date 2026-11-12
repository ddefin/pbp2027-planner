import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getSessionUser } from "../lib/session.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { StravaError, authorizeUrl, disconnect, exchangeCode, purgeLocal, readState, redirectUri, saveConnection, stravaConfigured, syncAccount, syncOneActivity, validAccessToken } from "../lib/strava.js";
import { analyze } from "../lib/stravaCoach.js";
import { fitness, intensityShare, lastDays, sinceYearStart, sumVolume, weeklySeries } from "../lib/stravaMetrics.js";
import { loadActivities, parsePrefs, parisParts, sendActivityReport } from "../lib/coachReports.js";

export const MCP_URL = "https://mcp.strava.com/mcp";

const prefsSchema = z.object({
  profile: z.enum(["endurance", "performance", "forme"]),
  tone: z.enum(["bienveillant", "direct", "technique"]),
  frequency: z.enum(["activite", "hebdo", "demande"]),
  metrics: z.array(z.enum(["hr", "power", "elevation", "speed"])).min(1).max(4),
  goal: z.string().trim().max(120).nullable().optional(),
});

const REQUIRED_SCOPE = "activity:read_all";

export async function stravaRoutes(app: FastifyInstance) {
  // État de la connexion + ce qu'il manque côté serveur.
  app.get("/strava/status", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const acc = await prisma.stravaAccount.findUnique({ where: { userId: user.id } });
    return reply.send({
      configured: stravaConfigured() && Boolean(redirectUri()),
      // Ce que le SERVEUR voit réellement (jamais les valeurs) : aide à trouver une variable
      // mal nommée ou pas relue par le conteneur.
      missing: [
        ...(config.stravaClientId ? [] : ["STRAVA_CLIENT_ID"]),
        ...(config.stravaClientSecret ? [] : ["STRAVA_CLIENT_SECRET"]),
        ...(redirectUri() ? [] : ["PUBLIC_URL (ou STRAVA_REDIRECT_URI)"]),
      ],
      redirectUri: redirectUri(),
      mcpUrl: MCP_URL,
      connected: Boolean(acc),
      account: acc && {
        athleteName: acc.athleteName,
        profilePhoto: acc.profilePhoto,
        lastSyncAt: acc.lastSyncAt?.toISOString() ?? null,
        lastSyncError: acc.lastSyncError,
        connectedAt: acc.connectedAt.toISOString(),
        scopeOk: acc.scope.split(",").includes(REQUIRED_SCOPE),
        ftp: acc.ftp,
        maxHr: acc.maxHr,
      },
    });
  });

  // L'interface navigue vers cette URL (le cookie de session est « strict » : un
  // <a> direct vers l'API serait aussi possible, mais on garde la logique côté serveur).
  app.get("/strava/connect", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const url = authorizeUrl(user.id);
    if (!url) return reply.code(503).send({ error: "strava_not_configured" });
    return reply.send({ url });
  });

  // Retour de Strava (navigation depuis strava.com, sans cookie « strict ») : c'est le
  // `state` signé qui identifie le compte.
  app.get("/strava/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; scope?: string; error?: string };
    const back = (status: string) => reply.redirect(`/profil?strava=${status}#strava`);
    if (q.error) return back("denied");
    const userId = q.state ? readState(q.state) : null;
    if (!userId || !q.code || !stravaConfigured()) return back("invalid");
    // Le sportif peut décocher des autorisations sur l'écran Strava : sans la lecture
    // de ses activités, la connexion ne servirait à rien.
    const granted = (q.scope ?? "").split(",");
    if (!granted.includes(REQUIRED_SCOPE)) return back("scope");
    try {
      const token = await exchangeCode(q.code);
      await saveConnection(userId, token, q.scope ?? "");
    } catch (err) {
      if (err instanceof StravaError && err.code === "athlete_limit") {
        // L'administrateur doit demander à Strava d'augmenter la capacité de l'application.
        const [who, admins] = await Promise.all([prisma.user.findUnique({ where: { id: userId }, select: { prenom: true } }), prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } })]);
        for (const a of admins) {
          await prisma.notification.create({ data: { userId: a.id, kind: "strava_limit", message: `🚴 ${who?.prenom ?? "Un randonneur"} n'a pas pu connecter Strava : limite de sportifs de l'application atteinte. Demande une augmentation de capacité sur strava.com/settings/api.`, link: "/profil#strava" } }).catch(() => undefined);
        }
        return back("limit");
      }
      return back("error");
    }
    void syncAccount(userId, { force: true }); // première synchro en arrière-plan
    return back("ok");
  });

  app.post("/strava/sync", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const rl = checkRateLimit(`strava-sync:${user.id}`, 6, 10 * 60_000);
    if (!rl.allowed) return reply.code(429).send({ error: "rate_limited" });
    const result = await syncAccount(user.id);
    return reply.send(result);
  });

  app.post("/strava/disconnect", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send(await disconnect(user.id));
  });

  // Tableau de bord : KPI, forme, intensités, 8 semaines, analyse du Coach.
  app.get("/strava/dashboard", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const acc = await prisma.stravaAccount.findUnique({ where: { userId: user.id } });
    if (!acc) return reply.code(404).send({ error: "not_connected" });
    const now = new Date();
    const list = await loadActivities(user.id, now);
    const prefs = parsePrefs(await prisma.coachPrefs.findUnique({ where: { userId: user.id } }));
    // « Aujourd'hui » = le jour calendaire à Paris, comme les jours locaux des sorties.
    const ref = new Date(`${parisParts(now).date}T00:00:00Z`);
    const recent = [...list].reverse().slice(0, 5);
    return reply.send({
      kpis: { d7: sumVolume(lastDays(list, 7, ref)), d30: sumVolume(lastDays(list, 30, ref)), year: sumVolume(sinceYearStart(list, ref)) },
      fitness: fitness(list, ref),
      intensity: { week: intensityShare(lastDays(list, 7, ref)), month: intensityShare(lastDays(list, 28, ref)) },
      weekly: weeklySeries(list, 8, ref),
      coach: analyze(list, prefs, ref),
      recent: recent.map((a) => ({ at: a.startLocal.toISOString(), km: Math.round(a.distanceM / 100) / 10, hours: Math.round((a.movingSec / 3600) * 10) / 10, elevationM: Math.round(a.elevationM), load: Math.round(a.load), zone: a.zone })),
      empty: list.length === 0,
    });
  });

  app.get("/strava/coach-prefs", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const row = await prisma.coachPrefs.findUnique({ where: { userId: user.id } });
    const p = parsePrefs(row);
    return reply.send({ prefs: { ...p, frequency: row?.frequency ?? "hebdo" } });
  });

  app.put("/strava/coach-prefs", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { metrics, goal, ...rest } = parsed.data;
    const data = { ...rest, metrics: JSON.stringify([...new Set(metrics)]), goal: goal?.trim() || null };
    await prisma.coachPrefs.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return reply.send({ ok: true });
  });

  // Test de joignabilité du serveur MCP officiel. Il ne peut PAS vérifier la liaison faite
  // par le sportif dans Claude/Gemini (l'authentification se fait dans l'assistant) :
  // un 401 signifie « serveur joignable, authentification requise », ce qui est normal.
  app.post("/strava/mcp-test", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const rl = checkRateLimit(`strava-mcp:${user.id}`, 6, 10 * 60_000);
    if (!rl.allowed) return reply.code(429).send({ error: "rate_limited" });
    try {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pbp-planner-check", version: "1.0" } } }),
        signal: AbortSignal.timeout(8000),
      });
      const reachable = res.status < 500;
      return reply.send({
        reachable,
        status: res.status,
        message: res.status === 401 || res.status === 403 ? "Serveur MCP Strava joignable (authentification requise, c'est normal : tu te connectes depuis ton assistant)." : reachable ? "Serveur MCP Strava joignable." : `Le serveur MCP Strava répond avec une erreur (HTTP ${res.status}).`,
      });
    } catch {
      return reply.send({ reachable: false, status: null, message: "Serveur MCP Strava injoignable depuis le serveur du site (réseau ou pare-feu)." });
    }
  });

  // ─── Webhooks Strava (sans session) ───
  // Vérification de l'abonnement : Strava appelle en GET avec un défi à renvoyer.
  app.get("/strava/webhook", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const token = config.stravaWebhookVerifyToken;
    if (!token || q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== token) return reply.code(403).send({ error: "forbidden" });
    return reply.send({ "hub.challenge": q["hub.challenge"] });
  });

  app.post("/strava/webhook", async (request, reply) => {
    const ev = request.body as { object_type?: string; object_id?: number; aspect_type?: string; owner_id?: number; updates?: Record<string, string> } | null;
    // Strava exige une réponse 200 sous 2 s : le traitement se fait ensuite.
    reply.code(200).send({ ok: true });
    if (!ev?.owner_id || !ev.object_type) return;
    const owner = String(ev.owner_id);
    try {
      if (ev.object_type === "activity" && ev.object_id && (ev.aspect_type === "create" || ev.aspect_type === "update" || ev.aspect_type === "delete")) {
        const r = await syncOneActivity(owner, String(ev.object_id), ev.aspect_type);
        if (r?.created) await sendActivityReport(r.userId, String(ev.object_id));
      } else if (ev.object_type === "athlete" && ev.updates?.authorized === "false") {
        // Déautorisation faite sur strava.com : l'événement n'est pas signé, on vérifie
        // que le jeton est réellement mort avant d'effacer (sinon n'importe qui pourrait
        // déconnecter un sportif en postant un faux événement).
        const acc = await prisma.stravaAccount.findUnique({ where: { athleteId: owner } });
        if (!acc) return;
        const dead = await validAccessToken(acc.userId)
          .then(async (t) => (await fetch("https://www.strava.com/api/v3/athlete", { headers: { authorization: `Bearer ${t}` } })).status === 401)
          .catch((err) => err instanceof StravaError && (err.status === 400 || err.status === 401));
        if (dead) await purgeLocal(acc.userId);
      }
    } catch (err) {
      request.log.error(err, "traitement du webhook Strava");
    }
  });
}
