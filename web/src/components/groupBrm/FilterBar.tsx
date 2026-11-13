import { CalendarDays, Users, X } from "lucide-react";
import type { Member } from "./model";
import { GROUP_DISTANCES } from "./model";
import type { GroupView } from "./useGroupBrmFilters";

// Barre collante : vue, distances, randonneur, BRM passés.
export function FilterBar({
  view,
  onView,
  dist,
  onDist,
  members,
  member,
  onMember,
  showPast,
  onShowPast,
  countLabel,
  filtered,
  onReset,
}: {
  view: GroupView;
  onView: (v: GroupView) => void;
  dist: number | null;
  onDist: (d: number | null) => void;
  members: Member[];
  member: string | null;
  onMember: (k: string | null) => void;
  showPast: boolean;
  onShowPast: (v: boolean) => void;
  countLabel: string;
  filtered: boolean;
  onReset: () => void;
}) {
  return (
    <div className="gb-bar" role="region" aria-label="Filtres des BRM du groupe">
      <div className="gb-bar-row">
        <div className="gb-tabs" role="tablist" aria-label="Affichage">
          <button type="button" role="tab" aria-selected={view === "chrono"} className="gb-tab" onClick={() => onView("chrono")}>
            <CalendarDays size={15} aria-hidden="true" /> Chronologie
          </button>
          <button type="button" role="tab" aria-selected={view === "membres"} className="gb-tab" onClick={() => onView("membres")}>
            <Users size={15} aria-hidden="true" /> Par randonneur
          </button>
        </div>
        <select className="gb-select" value={member ?? ""} onChange={(e) => onMember(e.target.value || null)} aria-label="Filtrer par randonneur">
          <option value="">Tout le groupe</option>
          {members.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
              {m.mine ? " (toi)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="gb-bar-row">
        <div className="gb-pills" role="group" aria-label="Distance">
          <button type="button" className="gb-pill" aria-pressed={dist === null} onClick={() => onDist(null)}>
            Tous
          </button>
          {GROUP_DISTANCES.map((d) => (
            <button key={d} type="button" className={`gb-pill gb-pill-${d}`} aria-pressed={dist === d} onClick={() => onDist(dist === d ? null : d)}>
              {d}
            </button>
          ))}
        </div>
        <label className="gb-switch">
          <input type="checkbox" checked={!showPast} onChange={(e) => onShowPast(!e.target.checked)} />
          <span>Masquer les passés</span>
        </label>
      </div>
      <div className="gb-bar-foot" aria-live="polite">
        <span>{countLabel}</span>
        {filtered && (
          <button type="button" className="gb-reset" onClick={onReset}>
            <X size={13} aria-hidden="true" /> Effacer les filtres
          </button>
        )}
      </div>
    </div>
  );
}
