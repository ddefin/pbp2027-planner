import type { RoadbookControl, ScheduleRow } from "../../lib/roadbook";
import { formatMinutes } from "../../lib/roadbook";

const MARGIN_TIGHT_MIN = 45;

function clock(startAt: string | null, minutes: number): string {
  if (!startAt) return `+${formatMinutes(minutes)}`;
  return new Date(new Date(startAt).getTime() + minutes * 60_000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

// Table des passages (roadbook) : une ligne par contrôle, heure prévue d'arrivée, pause,
// fenêtre officielle d'ouverture/fermeture et marge. Éditable par le propriétaire
// (nom, pause, suppression), en lecture seule sur le lien partagé et à l'impression.
export function ScheduleTable({
  schedule,
  controls,
  startAt,
  passedKm,
  editable,
  onChange,
  onSelectKm,
}: {
  schedule: ScheduleRow[];
  controls: RoadbookControl[];
  startAt: string | null;
  passedKm: number | null;
  editable: boolean;
  onChange?: (controls: RoadbookControl[]) => void;
  onSelectKm?: (km: number) => void;
}) {
  const sorted = [...controls].sort((a, b) => a.km - b.km);
  const update = (i: number, patch: Partial<RoadbookControl>) => onChange?.(sorted.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange?.(sorted.filter((_, j) => j !== i));

  return (
    <div className="ctrl-table-wrap">
      <table className="ctrl-table rb-table">
        <thead>
          <tr>
            <th>Contrôle</th>
            <th className="num">Km</th>
            <th className="num">Étape</th>
            <th>Arrivée prévue</th>
            <th className="num">Pause</th>
            <th>Ouvre / ferme</th>
            <th className="num">Marge</th>
            {editable && <th className="no-print" />}
          </tr>
        </thead>
        <tbody>
          {schedule.map((row, i) => {
            const isEdge = i === 0 || i === schedule.length - 1;
            const level = row.marginMin < 0 ? "late" : row.marginMin < MARGIN_TIGHT_MIN ? "tight" : "ok";
            const passed = passedKm !== null && row.km <= passedKm + 0.05;
            return (
              <tr key={`${row.km}-${i}`} className={passed ? "is-passed" : undefined} onClick={() => onSelectKm?.(row.km)}>
                <td>
                  {editable ? (
                    <input className="rb-input no-print-border" value={sorted[i].name} maxLength={80} onClick={(e) => e.stopPropagation()} onChange={(e) => update(i, { name: e.target.value })} />
                  ) : (
                    <strong>{row.name}</strong>
                  )}
                  {row.legGainM !== null && row.legGainM > 0 && <div className="ctrl-note">D+ {row.legGainM} m depuis le précédent</div>}
                </td>
                <td className="num tabular">{row.km.toFixed(1)}</td>
                <td className="num tabular">{i === 0 ? "" : row.legKm.toFixed(1)}</td>
                <td className="tabular">
                  <strong>{clock(startAt, row.arriveMin)}</strong>
                </td>
                <td className="num tabular">
                  {editable && !isEdge ? (
                    <input
                      className="rb-input rb-input-num"
                      type="number"
                      min={0}
                      max={600}
                      step={5}
                      value={sorted[i].stopMinutes}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => update(i, { stopMinutes: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })}
                      aria-label={`Pause à ${row.name} (minutes)`}
                    />
                  ) : row.stopMinutes ? (
                    `${row.stopMinutes} min`
                  ) : (
                    ""
                  )}
                </td>
                <td className="tabular rb-window">
                  {clock(startAt, row.openMin)} → {clock(startAt, row.closeMin)}
                </td>
                <td className={`num tabular rb-margin lvl-text-${level}`}>{formatMinutes(row.marginMin)}</td>
                {editable && (
                  <td className="no-print">
                    {!isEdge && (
                      <button
                        type="button"
                        className="ghost rb-del"
                        aria-label={`Retirer ${row.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(i);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
