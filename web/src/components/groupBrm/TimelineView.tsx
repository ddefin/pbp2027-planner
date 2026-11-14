import type { ReactNode } from "react";
import type { CatalogEvent } from "../../api/brmCatalog";
import { BrmRow } from "./BrmRow";
import { monthLabel } from "./model";

export function TimelineView({
  events,
  today,
  highlight,
  renderAction,
}: {
  events: CatalogEvent[];
  today: string;
  highlight: string | null;
  renderAction?: (event: CatalogEvent) => ReactNode;
}) {
  const months = new Map<string, CatalogEvent[]>();
  for (const e of events) {
    const k = e.date.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), e]);
  }
  return (
    <div className={`gb-timeline${renderAction ? " gb-timeline--action" : ""}`}>
      <div className="gb-head" aria-hidden="true">
        <span>Date</span>
        <span>Distance</span>
        <span>Lieu · organisateur</span>
        <span>D+</span>
        <span>Inscrits</span>
        {renderAction && <span>Mon statut</span>}
        <span />
      </div>
      {[...months.entries()].map(([k, list]) => (
        <section key={k} className="gb-month" aria-label={monthLabel(k)}>
          <h3 className="gb-month-title">
            {monthLabel(k)} <span>{list.length}</span>
          </h3>
          <ul className="gb-list">
            {list.map((e) => (
              <BrmRow key={e.id} event={e} highlight={highlight} past={e.date < today} action={renderAction?.(e)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
