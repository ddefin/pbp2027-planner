import { useState } from "react";
import type { Checkin } from "../../api/roadbooks";
import type { TrackPoint } from "../../api/brmCatalog";
import { gainBetween } from "../../lib/roadbook";
import { StatusBadge } from "./StatusBadge";
import { meters, placeFor, when, type LiveModel } from "./model";

const SHOWN = 12;

// Bloc 3 (bas) : journal des pointages, du plus récent au plus ancien.
export function CheckinTimeline({ checkins, points, model, now }: { checkins: Checkin[]; points: TrackPoint[]; model: LiveModel; now: Date }) {
  const [all, setAll] = useState(false);
  const list = all ? checkins : checkins.slice(0, SHOWN);
  return (
    <section className="lv-card" aria-labelledby="lv-log-title">
      <h2 id="lv-log-title">Journal de bord</h2>
      {checkins.length === 0 ? (
        <p className="lv-empty">Les pointages apparaîtront ici dès le départ.</p>
      ) : (
        <ol className="lv-log">
          {list.map((c, i) => (
            <li key={`${c.at}-${i}`} className={i === 0 ? "is-last" : undefined}>
              <time dateTime={c.at}>{when(new Date(c.at), now)}</time>
              <div className="lv-log-body">
                <p className="lv-log-place">
                  <strong>{placeFor(c.km, model.schedule, null)}</strong>
                  {c.status !== "route" && <StatusBadge status={c.status} small />}
                </p>
                <p className="lv-log-meta">
                  km {Math.round(c.km)} · D+ {meters(gainBetween(points, 0, c.km))}
                </p>
                {c.message && <p className="lv-log-msg">« {c.message} »</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {checkins.length > SHOWN && (
        <button type="button" className="lv-more" onClick={() => setAll((v) => !v)}>
          {all ? "Afficher moins" : `Afficher les ${checkins.length} pointages`}
        </button>
      )}
    </section>
  );
}
