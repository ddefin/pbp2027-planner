import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KeyRound, ScrollText, Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/States";
import { useDebouncedSearch, useServerList } from "../components/useServerList";
import { listAudit, listAuthEvents, type AuditListRow, type AuthEventRow } from "../api";
import { ACTION_LABEL, EVENT_LABEL, fmtDateTime } from "../format";
import { AUDIT_ACTIONS, AUTH_KINDS } from "../../../../src/shared/adminSchemas";

function AdminActions() {
  const list = useServerList<AuditListRow>(listAudit, ["action"]);
  const [search, setSearch] = useDebouncedSearch(list.q, list.update);
  const columns = useMemo<Column<AuditListRow>[]>(
    () => [
      { key: "at", header: "Date", render: (a) => <span className="ad-num ad-nowrap">{fmtDateTime(a.at)}</span> },
      {
        key: "what",
        header: "Action",
        render: (a) => (
          <span className="ad-stack">
            <span>
              <strong>{a.actorEmail}</strong> {ACTION_LABEL[a.action] ?? a.action}{" "}
              {a.targetType === "user" && a.action !== "user.delete" ? <Link to={`/admin/utilisateurs/${a.targetId}`}>{a.targetLabel}</Link> : <strong>{a.targetLabel}</strong>}
            </span>
            {typeof a.metadata?.reason === "string" && <small>Motif : {a.metadata.reason}</small>}
          </span>
        ),
      },
      { key: "ip", header: "Adresse IP", render: (a) => <span className="ad-muted ad-num">{a.ip ?? "—"}</span>, hideOnMobile: true },
    ],
    [],
  );
  return (
    <>
      <div className="ad-toolbar">
        <label className="ad-input-icon">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Administrateur, compte visé, motif…" aria-label="Rechercher dans le journal" />
        </label>
        <select value={list.extras.action} onChange={(e) => list.update({ action: e.target.value || null })} aria-label="Filtrer par action">
          <option value="">Toutes les actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      {list.error && <div className="ad-callout is-danger" role="alert">{list.error}</div>}
      <DataTable
        caption="Journal d'audit"
        columns={columns}
        rows={list.data?.items ?? []}
        getId={(a) => a.id}
        loading={list.loading}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPage={(p) => list.update({ page: p }, false)}
        onPageSize={(n) => list.update({ taille: n })}
        empty={<EmptyState icon={ScrollText} title="Aucune action enregistrée" text="Chaque suspension, changement de rôle ou suppression est tracé ici, sans possibilité de modification." />}
      />
    </>
  );
}

function AccountEvents() {
  const list = useServerList<AuthEventRow>(listAuthEvents, ["kind"]);
  const [search, setSearch] = useDebouncedSearch(list.q, list.update);
  const columns = useMemo<Column<AuthEventRow>[]>(
    () => [
      { key: "at", header: "Date", render: (e) => <span className="ad-num ad-nowrap">{fmtDateTime(e.at)}</span> },
      { key: "email", header: "Adresse", render: (e) => <span className="ad-cell-sub">{e.email}</span> },
      {
        key: "kind",
        header: "Événement",
        render: (e) => {
          const l = EVENT_LABEL[e.kind] ?? { label: e.kind, tone: "info" as const };
          return (
            <span className="ad-stack">
              <span className={`ad-event is-${l.tone}`}>{l.label}</span>
              {e.detail && <small>{e.detail}</small>}
            </span>
          );
        },
      },
    ],
    [],
  );
  return (
    <>
      <div className="ad-toolbar">
        <label className="ad-input-icon">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Adresse e-mail (même sans compte)…" aria-label="Rechercher une adresse" />
        </label>
        <select value={list.extras.kind} onChange={(e) => list.update({ kind: e.target.value || null })} aria-label="Filtrer par événement">
          <option value="">Tous les événements</option>
          {AUTH_KINDS.map((k) => (
            <option key={k} value={k}>
              {EVENT_LABEL[k]?.label ?? k}
            </option>
          ))}
        </select>
      </div>
      {list.error && <div className="ad-callout is-danger" role="alert">{list.error}</div>}
      <DataTable
        caption="Événements de compte"
        columns={columns}
        rows={list.data?.items ?? []}
        getId={(e) => e.id}
        loading={list.loading}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPage={(p) => list.update({ page: p }, false)}
        onPageSize={(n) => list.update({ taille: n })}
        empty={<EmptyState icon={KeyRound} title="Aucun événement" text="Connexions, verrouillages et demandes de mot de passe (60 derniers jours)." />}
      />
    </>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("onglet") === "comptes" ? "comptes" : "admin";
  return (
    <>
      <PageHeader title="Journaux d'audit" description="Qui a fait quoi, sur quoi, et quand. Le journal des actions d'administration ne peut être ni modifié ni effacé." />
      <div className="ad-tabs" role="tablist" aria-label="Journal affiché">
        <button type="button" role="tab" aria-selected={tab === "admin"} className="ad-tab" onClick={() => setParams({}, { replace: true })}>
          <ScrollText size={16} aria-hidden="true" /> Actions d'administration
        </button>
        <button type="button" role="tab" aria-selected={tab === "comptes"} className="ad-tab" onClick={() => setParams({ onglet: "comptes" }, { replace: true })}>
          <KeyRound size={16} aria-hidden="true" /> Connexions et mots de passe
        </button>
      </div>
      <div className="ad-card ad-card-flush" role="tabpanel">
        {tab === "admin" ? <AdminActions key="admin" /> : <AccountEvents key="comptes" />}
      </div>
    </>
  );
}
