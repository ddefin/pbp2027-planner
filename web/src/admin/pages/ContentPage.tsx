import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Map as MapIcon, MessagesSquare, Route, Search, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/States";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toaster";
import { useDebouncedSearch, useServerList } from "../components/useServerList";
import { deleteContent, errorText, listContent, type ContentKind, type MessageRow, type RouteRow, type TrackRow } from "../api";
import { fmtAgo, fmtDateTime } from "../format";
import { contentDeleteSchema } from "../../../../src/shared/adminSchemas";

const TABS: { id: string; kind: ContentKind; label: string; icon: typeof MapIcon }[] = [
  { id: "messages", kind: "messages", label: "Messages du groupe", icon: MessagesSquare },
  { id: "traces", kind: "pbp-routes", label: "Tracés PBP", icon: MapIcon },
  { id: "brm", kind: "brm-tracks", label: "Traces des BRM", icon: Route },
];

type Row = MessageRow | RouteRow | TrackRow;

function ContentList({ kind, onDelete, reloadKey }: { kind: ContentKind; onDelete: (row: Row) => void; reloadKey: number }) {
  const list = useServerList<Row>((p) => listContent<Row>(kind, p), [], [kind, reloadKey]);
  const [search, setSearch] = useDebouncedSearch(list.q, list.update);
  const del = (r: Row) => (
    <button type="button" className="ad-icon-btn" aria-label="Supprimer ce contenu" title="Supprimer" onClick={() => onDelete(r)}>
      <Trash2 size={16} aria-hidden="true" />
    </button>
  );
  const columns = useMemo<Column<Row>[]>(() => {
    if (kind === "messages")
      return [
        {
          key: "text",
          header: "Message",
          render: (r) => {
            const m = r as MessageRow;
            return (
              <span className="ad-stack">
                <span className="ad-cell-text">
                  {m.fileName ? <><FileText size={14} aria-hidden="true" /> {m.fileName} </> : null}
                  {m.text || <em className="ad-muted">(pièce jointe)</em>}
                </span>
                <small>{m.author}</small>
              </span>
            );
          },
        },
        { key: "at", header: "Date", render: (r) => <span className="ad-muted" title={fmtDateTime(r.at)}>{fmtAgo(r.at)}</span> },
        { key: "del", header: "", className: "ad-col-actions", render: del },
      ];
    if (kind === "pbp-routes")
      return [
        { key: "label", header: "Tracé", render: (r) => { const x = r as RouteRow; return <span className="ad-stack"><strong>{x.label}</strong><small>{x.fileName} · {x.distanceKm} km · par {x.author}</small></span>; } },
        { key: "kind", header: "Type", render: (r) => <span className="ad-badge is-member">{(r as RouteRow).kind}</span> },
        { key: "at", header: "Date", render: (r) => <span className="ad-muted">{fmtAgo(r.at)}</span>, hideOnMobile: true },
        { key: "del", header: "", className: "ad-col-actions", render: del },
      ];
    return [
      { key: "label", header: "Trace", render: (r) => { const x = r as TrackRow; return <span className="ad-stack"><strong>{x.label}</strong><small>BRM {x.catalogEventId}{x.distanceKm ? ` · ${x.distanceKm} km` : ""} · par {x.author}</small></span>; } },
      { key: "type", header: "Type", render: (r) => <span className="ad-badge is-member">{(r as TrackRow).type}</span> },
      { key: "at", header: "Date", render: (r) => <span className="ad-muted">{fmtAgo(r.at)}</span>, hideOnMobile: true },
      { key: "del", header: "", className: "ad-col-actions", render: del },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <>
      <div className="ad-toolbar">
        <label className="ad-input-icon">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher un contenu" />
        </label>
      </div>
      {list.error && <div className="ad-callout is-danger" role="alert">{list.error}</div>}
      <DataTable
        caption="Contenus"
        columns={columns}
        rows={list.data?.items ?? []}
        getId={(r) => r.id}
        loading={list.loading}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPage={(p) => list.update({ page: p }, false)}
        onPageSize={(n) => list.update({ taille: n })}
        empty={<EmptyState icon={TABS.find((t) => t.kind === kind)!.icon} title={list.q ? "Aucun résultat" : "Rien à modérer"} text={list.q ? "Essaie un autre mot." : undefined} />}
      />
    </>
  );
}

export function ContentPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("onglet")) ?? TABS[0];
  const toast = useToast();
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function confirmDelete() {
    if (!target || !contentDeleteSchema.safeParse({ reason }).success) return;
    setBusy(true);
    try {
      await deleteContent(tab.kind, target.id, reason.trim());
      toast("success", "Contenu supprimé. L'action est inscrite au journal d'audit.");
      setTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const label = target ? ("text" in target ? (target.text || (target as MessageRow).fileName || "ce message") : target.label) : "";
  return (
    <>
      <PageHeader title="Contenus" description="Modérer ce qui est partagé avec le groupe. Les roadbooks restent privés et ne sont pas modérables." />
      <div className="ad-tabs" role="tablist" aria-label="Type de contenu">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab.id === t.id} className="ad-tab" onClick={() => setParams({ onglet: t.id }, { replace: true })}>
            <t.icon size={16} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      <div className="ad-card ad-card-flush" role="tabpanel">
        <ContentList key={tab.kind} kind={tab.kind} onDelete={(r) => (setReason(""), setTarget(r))} reloadKey={reloadKey} />
      </div>
      <Dialog
        open={target !== null}
        title="Supprimer ce contenu"
        tone="danger"
        onClose={() => !busy && setTarget(null)}
        onSubmit={() => void confirmDelete()}
        footer={
          <>
            <button type="button" className="ad-btn" onClick={() => setTarget(null)} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="ad-btn is-danger" disabled={busy || reason.trim().length < 3}>
              {busy ? "Patiente…" : "Supprimer définitivement"}
            </button>
          </>
        }
      >
        <p>
          « {label.length > 140 ? `${label.slice(0, 139)}…` : label} » sera supprimé pour tout le monde{tab.kind === "messages" ? ", y compris chez les membres connectés" : ""}. Action irréversible.
        </p>
        <label className="ad-field">
          <span>Motif (inscrit au journal d'audit)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} required autoFocus placeholder="ex. doublon, contenu hors sujet, demande de l'auteur…" />
        </label>
      </Dialog>
    </>
  );
}
