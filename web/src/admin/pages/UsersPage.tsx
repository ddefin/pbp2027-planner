import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ban, MoreHorizontal, RotateCcw, Search, Trash2, UserCheck, Users, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/States";
import { RoleBadge, StatusBadge } from "../components/StatusBadge";
import { PresenceDot } from "../components/PresenceDot";
import { useUserActions } from "../components/UserActions";
import { useToast } from "../components/Toaster";
import { Dialog } from "../components/Dialog";
import { bulkUsers, errorText, listUsers } from "../api";
import { fmtDate } from "../format";
import { useAuth } from "../../context/AuthContext";
import type { Page, UserRow } from "../types";
import { reasonSchema } from "../../../../src/shared/adminSchemas";

const SORTS = ["createdAt", "prenom", "email", "lastSeenAt"];

function RowMenu({ row, me, onAction }: { row: UserRow; me: boolean; onAction: (k: "suspend" | "unsuspend" | "promote" | "demote" | "delete") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = (k: Parameters<typeof onAction>[0], label: string, Icon: typeof Ban, danger = false) => (
    <button
      role="menuitem"
      type="button"
      className={`ad-menu-item${danger ? " is-danger" : ""}`}
      onClick={() => {
        setOpen(false);
        onAction(k);
      }}
    >
      <Icon size={15} aria-hidden="true" /> {label}
    </button>
  );
  return (
    <div className="ad-profile" ref={ref}>
      <button type="button" className="ad-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions pour ${row.prenom}`} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="ad-menu" role="menu">
          <Link role="menuitem" className="ad-menu-item" to={`/admin/utilisateurs/${row.id}`}>
            <Users size={15} aria-hidden="true" /> Voir la fiche
          </Link>
          {!me && (row.status === "suspended" ? item("unsuspend", "Réactiver", RotateCcw) : item("suspend", "Suspendre", Ban))}
          {!me && (row.isAdmin ? item("demote", "Retirer le rôle admin", UserCheck) : item("promote", "Nommer administrateur", UserCheck))}
          {!me && item("delete", "Supprimer…", Trash2, true)}
          {me && <span className="ad-menu-note">C'est ton compte : actions désactivées.</span>}
        </div>
      )}
    </div>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("statut") ?? "all";
  const role = params.get("role") ?? "all";
  const presence = params.get("presence") ?? "all";
  const sort = SORTS.includes(params.get("tri") ?? "") ? params.get("tri")! : "createdAt";
  const dir = params.get("ordre") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = [10, 20, 50, 100].includes(Number(params.get("taille"))) ? Number(params.get("taille")) : 20;

  const [search, setSearch] = useState(q);
  const [data, setData] = useState<Page<UserRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "suspend" | "unsuspend">(null);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const update = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "all") next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage) next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Recherche instantanée (légère temporisation pour ne pas interroger le serveur à chaque touche).
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [search, q, update]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ q, status, role, presence, sort, dir, page: String(page), pageSize: String(pageSize) });
    listUsers(p)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, status, role, presence, sort, dir, page, pageSize, reload]);

  const actions = useUserActions(() => {
    setSelected(new Set());
    setReload((r) => r + 1);
  });

  const columns = useMemo<Column<UserRow>[]>(
    () => [
      {
        key: "prenom",
        header: "Membre",
        sortable: true,
        render: (u) => (
          <Link to={`/admin/utilisateurs/${u.id}`} className="ad-user-cell">
            <span className="ad-mini-avatar" aria-hidden="true">{u.prenom.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>
                {u.prenom} <PresenceDot presence={u.presence} lastSeenAt={u.lastSeenAt} compact />
              </strong>
              <small>{u.email}</small>
            </span>
          </Link>
        ),
      },
      { key: "role", header: "Rôle", render: (u) => <RoleBadge isAdmin={u.isAdmin} />, hideOnMobile: true },
      { key: "status", header: "Statut", render: (u) => <StatusBadge status={u.status} /> },
      { key: "createdAt", header: "Inscrit le", sortable: true, render: (u) => <span className="ad-num">{fmtDate(u.createdAt)}</span>, hideOnMobile: true },
      { key: "lastSeenAt", header: "Présence", sortable: true, render: (u) => <PresenceDot presence={u.presence} lastSeenAt={u.lastSeenAt} />, hideOnMobile: true },
      { key: "actions", header: "", className: "ad-col-actions", render: (u) => <RowMenu row={u} me={u.email === me?.email} onAction={(k) => actions.open(k, u)} /> },
    ],
    [me, actions],
  );

  async function runBulk() {
    if (!bulk) return;
    if (bulk === "suspend" && !reasonSchema.safeParse({ reason: bulkReason }).success) return;
    setBulkBusy(true);
    try {
      const ids = [...selected];
      const { results } = await bulkUsers(bulk, ids, bulk === "suspend" ? bulkReason.trim() : undefined);
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => r.error);
      toast(failed.length ? "error" : "success", `${ok} compte${ok > 1 ? "s" : ""} ${bulk === "suspend" ? "suspendu" : "réactivé"}${ok > 1 ? "s" : ""}${failed.length ? ` · ${failed.length} refusé${failed.length > 1 ? "s" : ""} (ton compte ou dernier admin)` : ""}.`);
      setBulk(null);
      setSelected(new Set());
      setReload((r) => r + 1);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBulkBusy(false);
    }
  }

  const filtered = q || status !== "all" || role !== "all" || presence !== "all";
  return (
    <>
      <PageHeader title="Utilisateurs" description="Rechercher, filtrer et gérer les comptes des randonneurs." />
      <div className="ad-card ad-card-flush">
        <div className="ad-toolbar">
          <label className="ad-input-icon">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Prénom, e-mail ou club…" aria-label="Rechercher un compte" />
          </label>
          <select value={status} onChange={(e) => update({ statut: e.target.value })} aria-label="Filtrer par statut">
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
            <option value="locked">Verrouillés</option>
          </select>
          <select value={role} onChange={(e) => update({ role: e.target.value })} aria-label="Filtrer par rôle">
            <option value="all">Tous les rôles</option>
            <option value="admin">Administrateurs</option>
            <option value="member">Membres</option>
          </select>
          <select value={presence} onChange={(e) => update({ presence: e.target.value })} aria-label="Filtrer par présence">
            <option value="all">Toute présence</option>
            <option value="online">🟢 En ligne</option>
            <option value="recent">🟠 Vus sous 72 h</option>
            <option value="away">🔴 Absents (+72 h)</option>
          </select>
          {filtered && (
            <button
              type="button"
              className="ad-btn is-ghost"
              onClick={() => {
                setSearch("");
                setParams({}, { replace: true });
              }}
            >
              <X size={14} aria-hidden="true" /> Effacer les filtres
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="ad-bulkbar" role="region" aria-label="Actions sur la sélection">
            <strong className="ad-num">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </strong>
            <button type="button" className="ad-btn" onClick={() => (setBulkReason(""), setBulk("suspend"))}>
              <Ban size={14} aria-hidden="true" /> Suspendre
            </button>
            <button type="button" className="ad-btn" onClick={() => setBulk("unsuspend")}>
              <RotateCcw size={14} aria-hidden="true" /> Réactiver
            </button>
            <button type="button" className="ad-btn is-ghost" onClick={() => setSelected(new Set())}>
              Désélectionner
            </button>
          </div>
        )}

        {error && <div className="ad-callout is-danger" role="alert">{error}</div>}
        <DataTable
          caption="Liste des comptes"
          columns={columns}
          rows={data?.items ?? []}
          getId={(u) => u.id}
          loading={loading}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          sort={sort}
          dir={dir}
          onSort={(k) => update({ tri: k, ordre: sort === k && dir === "desc" ? "asc" : "desc" })}
          onPage={(p) => update({ page: p }, false)}
          onPageSize={(n) => update({ taille: n })}
          selected={selected}
          onSelect={setSelected}
          empty={
            <EmptyState
              icon={Users}
              title={filtered ? "Aucun compte ne correspond" : "Aucun compte"}
              text={filtered ? "Essaie une autre recherche ou retire un filtre." : "Les inscriptions apparaîtront ici."}
            />
          }
        />
      </div>
      {actions.dialog}
      <Dialog
        open={bulk !== null}
        title={bulk === "suspend" ? `Suspendre ${selected.size} compte${selected.size > 1 ? "s" : ""}` : `Réactiver ${selected.size} compte${selected.size > 1 ? "s" : ""}`}
        tone={bulk === "suspend" ? "danger" : "default"}
        onClose={() => !bulkBusy && setBulk(null)}
        onSubmit={() => void runBulk()}
        footer={
          <>
            <button type="button" className="ad-btn" onClick={() => setBulk(null)} disabled={bulkBusy}>
              Annuler
            </button>
            <button type="submit" className={`ad-btn ${bulk === "suspend" ? "is-danger" : "is-primary"}`} disabled={bulkBusy || (bulk === "suspend" && bulkReason.trim().length < 3)}>
              {bulkBusy ? "Patiente…" : "Confirmer"}
            </button>
          </>
        }
      >
        {bulk === "suspend" ? (
          <>
            <p>Les comptes sélectionnés ne pourront plus se connecter. Ton propre compte et le dernier administrateur actif sont ignorés.</p>
            <label className="ad-field">
              <span>Motif (visible dans le journal)</span>
              <textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} maxLength={300} rows={3} required />
            </label>
          </>
        ) : (
          <p>Les comptes sélectionnés pourront de nouveau se connecter.</p>
        )}
      </Dialog>
    </>
  );
}
