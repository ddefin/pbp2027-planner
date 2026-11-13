import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, CheckCircle2, CircleAlert, ScrollText, UserPlus, Users } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { KpiCard } from "../components/KpiCard";
import { ActivityChart } from "../components/ActivityChart";
import { EmptyState, Skeleton } from "../components/States";
import { errorText, getAttention, getOverview } from "../api";
import { ACTION_LABEL, fmtAgo, fmtNum } from "../format";
import type { AttentionItem, Overview, Period } from "../types";

const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "7 j" },
  { id: "30d", label: "30 j" },
  { id: "12m", label: "12 mois" },
];

export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.some((p) => p.id === params.get("periode")) ? params.get("periode") : "30d") as Period;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getOverview(period)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period]);

  // « À surveiller » et « En ligne maintenant » : rafraîchis toutes les 30 s (page visible).
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      getAttention().then((a) => alive && setAttention(a)).catch(() => undefined);
      getOverview(period).then((d) => alive && setData((prev) => (prev ? { ...prev, online: d.online } : d))).catch(() => undefined);
    };
    getAttention().then((a) => alive && setAttention(a)).catch(() => undefined);
    const t = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [period]);

  const k = loading ? undefined : data?.kpis;
  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        description={data ? `${fmtNum(data.totals.members)} membres · ${fmtNum(data.totals.admins)} administrateur${data.totals.admins > 1 ? "s" : ""} · ${fmtNum(data.totals.suspended)} suspendu${data.totals.suspended > 1 ? "s" : ""}` : undefined}
        actions={
          <div className="ad-seg" role="group" aria-label="Période">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setParams({ periode: p.id }, { replace: true })}>
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      {error && <div className="ad-callout is-danger" role="alert">{error}</div>}

      <div className="ad-grid-2 ad-top-cards">
        <section className="ad-card" aria-labelledby="ad-att-title">
          <div className="ad-card-head">
            <h2 id="ad-att-title">À surveiller</h2>
          </div>
          {attention === null ? (
            <Skeleton height={18} />
          ) : attention.length === 0 ? (
            <p className="ad-allgood">
              <CheckCircle2 size={18} aria-hidden="true" /> Tout va bien : rien à signaler.
            </p>
          ) : (
            <ul className="ad-attention">
              {attention.map((a, i) => (
                <li key={`${a.kind}-${i}`} className={`is-${a.level}`}>
                  <CircleAlert size={16} aria-hidden="true" />
                  <Link to={a.link}>
                    <strong>{a.title}</strong>
                    {a.detail && <small>{a.detail}</small>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ad-card" aria-labelledby="ad-online-title">
          <div className="ad-card-head">
            <h2 id="ad-online-title">
              <span className="ad-presence is-online"><i aria-hidden="true" /></span> En ligne maintenant
              {data ? <span className="ad-count ad-num">{data.online.count}</span> : null}
            </h2>
            <Link to="/admin/utilisateurs?presence=online">Voir</Link>
          </div>
          {!data ? (
            <Skeleton height={18} />
          ) : data.online.count === 0 ? (
            <p className="ad-muted" style={{ margin: 0 }}>Personne d'autre que toi pour l'instant.</p>
          ) : (
            <ul className="ad-online">
              {data.online.users.map((u) => (
                <li key={u.id}>
                  <Link to={`/admin/utilisateurs/${u.id}`}>{u.prenom}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="ad-muted ad-legend">
            <span className="ad-presence is-online"><i aria-hidden="true" /> en ligne</span>
            <span className="ad-presence is-recent"><i aria-hidden="true" /> vu sous 72 h</span>
            <span className="ad-presence is-away"><i aria-hidden="true" /> absent +72 h</span>
          </p>
        </section>
      </div>

      <div className="ad-kpis">
        <KpiCard icon={Users} label="Membres actifs" kpi={k?.active} loading={loading} hint="vus sur la période" />
        <KpiCard icon={UserPlus} label="Nouveaux inscrits" kpi={k?.newUsers} loading={loading} />
        <KpiCard icon={Activity} label="Activité" kpi={k?.activity} loading={loading} hint={k ? `${fmtNum(k.activity.messages)} messages · ${fmtNum(k.activity.checkins)} pointages` : undefined} />
        <KpiCard icon={AlertTriangle} label="Incidents de compte" kpi={k?.incidents} loading={loading} goodWhenUp={false} hint={k?.incidents.partial ? "60 derniers jours au plus (journal conservé 60 j)" : "mails échoués, verrouillages, liens refusés"} />
      </div>

      <section className="ad-card">
        {loading && !data ? <Skeleton height={240} radius={10} /> : data ? <ActivityChart series={data.series} /> : null}
      </section>

      <div className="ad-grid-2">
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Dernières inscriptions</h2>
            <Link to="/admin/utilisateurs?tri=createdAt&ordre=desc">Tout voir</Link>
          </div>
          {loading && !data ? (
            <div className="ad-list">{[0, 1, 2].map((i) => <Skeleton key={i} height={18} />)}</div>
          ) : data && data.recentUsers.length > 0 ? (
            <ul className="ad-list">
              {data.recentUsers.map((u) => (
                <li key={u.id}>
                  <Link to={`/admin/utilisateurs/${u.id}`} className="ad-list-main">
                    <span className="ad-mini-avatar" aria-hidden="true">{u.prenom.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{u.prenom}</strong>
                      <small>{u.email}</small>
                    </span>
                  </Link>
                  <span className="ad-muted">{fmtAgo(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={UserPlus} title="Aucune inscription" />
          )}
        </section>
        <section className="ad-card">
          <div className="ad-card-head">
            <h2>Dernières actions d'administration</h2>
            <Link to="/admin/journaux">Journal complet</Link>
          </div>
          {loading && !data ? (
            <div className="ad-list">{[0, 1, 2].map((i) => <Skeleton key={i} height={18} />)}</div>
          ) : data && data.recentAudit.length > 0 ? (
            <ul className="ad-list">
              {data.recentAudit.map((a) => (
                <li key={a.id}>
                  <span className="ad-list-main">
                    <span>
                      <strong>{a.actorEmail}</strong> {ACTION_LABEL[a.action] ?? a.action} <strong>{a.targetLabel}</strong>
                    </span>
                  </span>
                  <span className="ad-muted">{fmtAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ScrollText} title="Aucune action pour l'instant" text="Suspensions, changements de rôle et suppressions apparaîtront ici." />
          )}
        </section>
      </div>
    </>
  );
}
