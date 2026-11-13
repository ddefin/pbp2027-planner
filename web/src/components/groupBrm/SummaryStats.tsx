import { CalendarClock, Route, Users } from "lucide-react";
import type { CatalogEvent } from "../../api/brmCatalog";
import { daysUntil } from "../../lib/brmMeta";
import { DistanceBadge } from "./DistanceBadge";
import { dayLabel } from "./model";

export function SummaryStats({ distinct, next, riders }: { distinct: number; next: CatalogEvent | null; riders: number }) {
  const j = next ? daysUntil(next.date) : null;
  return (
    <div className="gb-stats">
      <div className="gb-stat">
        <Route size={18} aria-hidden="true" />
        <div>
          <strong className="gb-num">{distinct}</strong>
          <span>BRM choisis</span>
        </div>
      </div>
      <div className="gb-stat gb-stat-next">
        <CalendarClock size={18} aria-hidden="true" />
        <div>
          {next ? (
            <>
              <strong>
                {dayLabel(next.date)} <span className="gb-j">{j === 0 ? "aujourd'hui" : `J-${j}`}</span>
              </strong>
              <span>
                <DistanceBadge distance={next.distance} /> {next.ville}
              </span>
            </>
          ) : (
            <>
              <strong>—</strong>
              <span>Aucun départ à venir</span>
            </>
          )}
        </div>
      </div>
      <div className="gb-stat">
        <Users size={18} aria-hidden="true" />
        <div>
          <strong className="gb-num">{riders}</strong>
          <span>randonneur{riders > 1 ? "s" : ""} engagé{riders > 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}
