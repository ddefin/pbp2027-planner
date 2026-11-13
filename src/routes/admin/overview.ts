import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { actorOf } from "../../lib/adminGuard.js";
import { periodQuery } from "../../shared/adminSchemas.js";

const DAY = 86_400_000;
const AUTH_RETENTION_DAYS = 60; // voir src/lib/authEvents.ts
const INCIDENT_KINDS = ["mail_failed", "login_locked", "reset_token_invalid", "login_suspended"];

type Period = "7d" | "30d" | "12m";

function windows(period: Period, now: Date) {
  if (period === "12m") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1));
    return { start, prevStart, days: Math.round((now.getTime() - start.getTime()) / DAY) };
  }
  const days = period === "7d" ? 7 : 30;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - (days - 1) * DAY);
  return { start, prevStart: new Date(start.getTime() - days * DAY), days };
}

// Variation en % ; null quand il n'y a pas de période de comparaison fiable.
const change = (cur: number, prev: number | null) => (prev === null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

function buckets(period: Period, start: Date, now: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (period === "12m") {
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      out.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }) });
    }
  } else {
    for (let t = start.getTime(); t <= now.getTime(); t += DAY) {
      const d = new Date(t);
      out.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }) });
    }
  }
  return out;
}

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.get("/overview", async (request, reply) => {
    actorOf(request);
    const { period } = periodQuery.parse(request.query);
    const now = new Date();
    const { start, prevStart } = windows(period, now);
    const inWin = { gte: start, lte: now };
    const inPrev = { gte: prevStart, lt: start };
    // Le journal de connexions n'est gardé que 60 jours : pas de comparaison au-delà.
    const authComparable = now.getTime() - prevStart.getTime() <= AUTH_RETENTION_DAYS * DAY;
    const realUser = { isSystem: false };

    const [members, admins, suspended, newUsers, newUsersPrev, msgs, msgsPrev, checkins, checkinsPrev, loginsNow, loginsPrev, sessionsNow, incidents, incidentsPrev] = await Promise.all([
      prisma.user.count({ where: realUser }),
      prisma.user.count({ where: { ...realUser, isAdmin: true } }),
      prisma.user.count({ where: { ...realUser, suspendedAt: { not: null } } }),
      prisma.user.findMany({ where: { ...realUser, createdAt: inWin }, select: { createdAt: true } }),
      prisma.user.count({ where: { ...realUser, createdAt: inPrev } }),
      prisma.groupMessage.findMany({ where: { createdAt: inWin }, select: { createdAt: true } }),
      prisma.groupMessage.count({ where: { createdAt: inPrev } }),
      prisma.roadbookCheckin.findMany({ where: { at: inWin }, select: { at: true } }),
      prisma.roadbookCheckin.count({ where: { at: inPrev } }),
      prisma.authEvent.findMany({ where: { kind: "login_ok", createdAt: inWin }, select: { email: true }, distinct: ["email"] }),
      prisma.authEvent.findMany({ where: { kind: "login_ok", createdAt: inPrev }, select: { email: true }, distinct: ["email"] }),
      prisma.session.findMany({ where: { lastSeenAt: inWin, user: realUser }, select: { userId: true }, distinct: ["userId"] }),
      prisma.authEvent.count({ where: { kind: { in: INCIDENT_KINDS }, createdAt: inWin } }),
      prisma.authEvent.count({ where: { kind: { in: INCIDENT_KINDS }, createdAt: inPrev } }),
    ]);

    // Actifs = vus sur la période (sessions) ; la connexion journalisée complète pour ceux
    // dont la session a expiré depuis.
    const active = Math.max(sessionsNow.length, loginsNow.length);
    const activityNow = msgs.length + checkins.length;

    const keyOf = (d: Date) => (period === "12m" ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));
    const series = buckets(period, start, now).map((b) => ({ ...b, inscriptions: 0, messages: 0, pointages: 0 }));
    const idx = new Map(series.map((s, i) => [s.key, i]));
    for (const u of newUsers) { const i = idx.get(keyOf(u.createdAt)); if (i !== undefined) series[i].inscriptions++; }
    for (const m of msgs) { const i = idx.get(keyOf(m.createdAt)); if (i !== undefined) series[i].messages++; }
    for (const c of checkins) { const i = idx.get(keyOf(c.at)); if (i !== undefined) series[i].pointages++; }

    const recentUsers = await prisma.user.findMany({ where: realUser, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, prenom: true, email: true, createdAt: true } });
    const recentAudit = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 });

    return reply.send({
      period,
      totals: { members, admins, suspended },
      kpis: {
        active: { value: active, previous: authComparable ? loginsPrev.length : null, change: authComparable ? change(active, loginsPrev.length) : null },
        newUsers: { value: newUsers.length, previous: newUsersPrev, change: change(newUsers.length, newUsersPrev) },
        activity: { value: activityNow, previous: msgsPrev + checkinsPrev, change: change(activityNow, msgsPrev + checkinsPrev), messages: msgs.length, checkins: checkins.length },
        incidents: { value: incidents, previous: authComparable ? incidentsPrev : null, change: authComparable ? change(incidents, incidentsPrev) : null, partial: !authComparable },
      },
      series,
      recentUsers: recentUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
      recentAudit: recentAudit.map((a) => ({ id: a.id, action: a.action, actorEmail: a.actorEmail, targetLabel: a.targetLabel, targetType: a.targetType, targetId: a.targetId, at: a.createdAt.toISOString() })),
    });
  });
}
