import { ExternalLink, Flame, Gauge, Mountain, Route, Timer, TrendingUp, Zap } from "lucide-react";
import type { StravaRecords } from "../../api/strava";
import { activityUrl, frDate, monthLabel, num } from "./stravaFormat";

const ICON = { distance: Route, elevation: Mountain, duration: Timer, avg: Gauge, vmax: Zap, week: TrendingUp, month: TrendingUp, streak: Flame } as const;
const UNIT = { km: "km", m: "m", h: "h", "km/h": "km/h", jours: "jours" } as const;

function when(r: StravaRecords["records"][number]): string {
  if (!r.date) return "";
  if (r.key === "month") return monthLabel(r.date.slice(0, 7));
  if (r.until) return `du ${frDate(r.date, { day: "numeric", month: "short" })} au ${frDate(r.until)}`;
  return frDate(r.date);
}

// « 🏆 Mes records » : sur les sorties synchronisées (13 mois), plus « depuis toujours ».
export function RecordsCard({ data }: { data: StravaRecords }) {
  const all = data.allTime;
  if (data.records.length === 0) return <p className="hint">Pas encore de sortie à vélo synchronisée.</p>;
  return (
    <div className="st-records">
      <ul className="st-rec-grid">
        {data.records.map((r) => {
          const Icon = ICON[r.key as keyof typeof ICON] ?? Route;
          return (
            <li key={r.key} className="st-rec">
              <Icon size={18} aria-hidden="true" />
              <span className="st-rec-label">{r.label}</span>
              <strong className="st-rec-value">
                {num(r.value, r.unit === "km/h" || r.unit === "h" ? 1 : 0)} <small>{UNIT[r.unit]}</small>
              </strong>
              <span className="st-rec-when">
                {when(r)}
                {r.activityId && (
                  <>
                    {" · "}
                    <a href={activityUrl(r.activityId)} target="_blank" rel="noopener noreferrer" title={r.activityName ?? undefined}>
                      voir <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint st-rec-scope">
        {data.history.done
          ? `Depuis ta première sortie à vélo sur Strava${data.history.firstRideAt ? ` (${frDate(data.history.firstRideAt)})` : ""}.`
          : `Historique lu jusqu'à ${data.history.oldestLoaded ? monthLabel(data.history.oldestLoaded.slice(0, 7)).toLowerCase() : "…"} : les sorties plus anciennes arrivent automatiquement (quelques jours au plus).`}
      </p>
      {all && (all.biggestRideM || all.all) && (
        <div className="st-alltime">
          <span className="st-alltime-cap">Depuis toujours sur Strava</span>
          {all.biggestRideM ? <span>Plus longue sortie <b>{num(all.biggestRideM / 1000)} km</b></span> : null}
          {all.biggestClimbM ? <span>Plus grosse montée <b>{num(all.biggestClimbM)} m</b></span> : null}
          {all.all ? (
            <span>
              Total <b>{num(all.all.distanceM / 1000)} km</b> · {num(all.all.count)} sorties · D+ {num(all.all.elevationM)} m
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
