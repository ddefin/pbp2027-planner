export type UserStatus = "active" | "suspended" | "locked";
export type Presence = "online" | "recent" | "away";
export type Period = "7d" | "30d" | "12m";

export interface Kpi {
  value: number;
  previous: number | null;
  change: number | null;
}

export interface Overview {
  period: Period;
  totals: { members: number; admins: number; suspended: number };
  online: { count: number; users: { id: string; prenom: string }[] };
  kpis: {
    active: Kpi;
    newUsers: Kpi;
    activity: Kpi & { messages: number; checkins: number };
    incidents: Kpi & { partial: boolean };
  };
  series: { key: string; label: string; inscriptions: number; messages: number; pointages: number }[];
  recentUsers: { id: string; prenom: string; email: string; createdAt: string }[];
  recentAudit: AuditRow[];
}

export interface AuditRow {
  id: string;
  action: string;
  actorEmail: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
  at: string;
  metadata?: Record<string, unknown> | null;
}

export interface UserRow {
  id: string;
  prenom: string;
  email: string;
  club: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  presence: Presence;
  status: UserStatus;
  suspendedReason: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserDetail {
  user: {
    id: string;
    prenom: string;
    email: string;
    club: string | null;
    licenceNumero: string | null;
    isAdmin: boolean;
    createdAt: string;
    status: UserStatus;
    lastSeenAt: string | null;
    presence: Presence;
    suspendedAt: string | null;
    suspendedReason: string | null;
    lockedUntil: string | null;
    failedLoginAttempts: number;
    activeResetLinks: number;
  };
  data: { roadbooks: number; messages: number; brm: number; pbpRoutes: number; strava: boolean; telegram: boolean };
  sessions: { device: string; lastSeenAt: string; createdAt: string }[];
  events: { kind: string; detail: string | null; at: string }[];
  audit: { id: string; action: string; actorEmail: string; metadata: Record<string, unknown> | null; at: string }[];
}

export interface AttentionItem {
  kind: "mail_failed" | "locked" | "backup" | "strava" | "mail_config";
  level: "error" | "warn";
  title: string;
  detail: string | null;
  link: string;
}

export interface AnnouncementRow {
  id: string;
  actorEmail: string;
  message: string;
  recipients: number;
  telegramSent: number;
  at: string;
}
