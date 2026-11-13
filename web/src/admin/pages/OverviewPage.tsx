import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, ScrollText, UserPlus, Users } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { KpiCard } from "../components/KpiCard";
import { ActivityChart } from "../components/ActivityChart";
import { EmptyState, Skeleton } from "../components/States";
import { errorText, getOverview } from "../api";
import { ACTION_LABEL, fmtAgo, fmtNum } from "../format";
import type { Overview, Period } from "../types";

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
