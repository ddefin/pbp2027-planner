import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "./States";
import { fmtNum } from "../format";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
  className?: string;
  // Colonne masquée sur petit écran (l'information reste dans la ligne principale).
  hideOnMobile?: boolean;
}

// Tableau piloté par le serveur : tri, pagination et sélection sont des props ; le parent
// garde l'état dans l'adresse (partageable, bouton retour du navigateur).
export function DataTable<T>({
  columns,
  rows,
  getId,
  loading,
  total,
  page,
  pageSize,
  sort,
  dir,
  onSort,
  onPage,
  onPageSize,
  selected,
  onSelect,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  getId: (row: T) => string;
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  sort?: string;
  dir?: "asc" | "desc";
  onSort?: (key: string) => void;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  selected?: Set<string>;
  onSelect?: (next: Set<string>) => void;
  empty: ReactNode;
  caption: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const ids = rows.map(getId);
  const allOnPage = selected && ids.length > 0 && ids.every((id) => selected.has(id));
  const someOnPage = selected && ids.some((id) => selected.has(id));

  return (
    <div className="ad-dt">
      <div className="ad-table-scroll">
        <table className="ad-table">
          <caption className="ad-sr">{caption}</caption>
          <thead>
            <tr>
              {onSelect && selected && (
                <th scope="col" className="ad-col-check">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner sur cette page"
                    checked={Boolean(allOnPage)}
                    ref={(el) => {
                      if (el) el.indeterminate = Boolean(someOnPage && !allOnPage);
                    }}
                    onChange={() => {
                      const next = new Set(selected);
                      if (allOnPage) ids.forEach((id) => next.delete(id));
                      else ids.forEach((id) => next.add(id));
                      onSelect(next);
                    }}
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort === c.key;
                return (
                  <th key={c.key} scope="col" className={`${c.className ?? ""}${c.hideOnMobile ? " ad-hide-sm" : ""}`} aria-sort={c.sortable ? (active ? (dir === "asc" ? "ascending" : "descending") : "none") : undefined}>
                    {c.sortable && onSort ? (
                      <button type="button" className={`ad-sort${active ? " is-active" : ""}`} onClick={() => onSort(c.key)}>
                        {c.header}
                        {active ? dir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              rows.length === 0 &&
              Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                <tr key={`sk-${i}`} aria-hidden="true">
                  {onSelect && <td className="ad-col-check" />}
                  {columns.map((c) => (
                    <td key={c.key} className={c.hideOnMobile ? "ad-hide-sm" : undefined}>
                      <Skeleton width={c.key === columns[0].key ? "70%" : "50%"} />
                    </td>
                  ))}
                </tr>
              ))}
            {rows.map((r) => {
              const id = getId(r);
              const isSel = selected?.has(id);
              return (
                <tr key={id} className={isSel ? "is-selected" : undefined}>
                  {onSelect && selected && (
                    <td className="ad-col-check">
                      <input
                        type="checkbox"
                        aria-label="Sélectionner la ligne"
                        checked={Boolean(isSel)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (isSel) next.delete(id);
                          else next.add(id);
                          onSelect(next);
                        }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.className ?? ""}${c.hideOnMobile ? " ad-hide-sm" : ""}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && empty}
      </div>
      <div className={`ad-pager${loading && rows.length > 0 ? " is-loading" : ""}`}>
        <span className="ad-num" aria-live="polite">
          {total === 0 ? "Aucun résultat" : `${fmtNum(from)}–${fmtNum(to)} sur ${fmtNum(total)}`}
        </span>
        <div className="ad-pager-ctl">
          {onPageSize && (
            <label className="ad-pager-size">
              <span className="ad-hide-sm">Par page</span>
              <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Lignes par page">
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="ad-icon-btn ad-bordered" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="ad-num ad-pager-pos">
            {page} / {pages}
          </span>
          <button type="button" className="ad-icon-btn ad-bordered" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
