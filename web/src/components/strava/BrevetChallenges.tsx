import { Check, ExternalLink } from "lucide-react";
import type { StravaRecords } from "../../api/strava";
import { activityUrl, frDate, monthLabel, num } from "./stravaFormat";

const BRM_MIN = 15;
const PBP_MIN = 13.3;

// « 🎯 Défis brevets » : paliers de distance, moyenne pauses comprises sur 200 km et plus,
// plus gros mois comparé aux 1 200 km du PBP.
export function BrevetChallenges({ data }: { data: StravaRecords["challenges"] }) {
  const b = data.best200;
  return (
    <div className="st-chal">
      <div>
        <p className="st-cap">Paliers de distance (une sortie)</p>
        <ul className="st-steps">
          {data.steps.map((s) => (
            <li key={s.km} className={s.done ? "is-done" : undefined}>
              <span className="st-step-dot" aria-hidden="true">{s.done ? <Check size={15} /> : null}</span>
              <span className="st-step-km">{s.km} km</span>
              <span className="st-step-when">
                {s.done && s.date && s.activityId ? (
                  <a href={activityUrl(s.activityId)} target="_blank" rel="noopener noreferrer">
                    {frDate(s.date)}
                  </a>
                ) : (
                  "pas encore"
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="hint">
          {data.rides200 > 0 ? `${data.rides200} sortie${data.rides200 > 1 ? "s" : ""} de 200 km et plus` : "Aucune sortie de 200 km sur les 13 derniers mois"} · paliers sur les 13
          derniers mois synchronisés.
        </p>
      </div>

      <div>
        <p className="st-cap">Moyenne « brevet » sur 200 km et plus (pauses comprises)</p>
        {b ? (
          <>
            <p className="st-avg">
              <strong>{num(b.kmh, 1)} km/h</strong> sur {num(b.km)} km —{" "}
              <a href={activityUrl(b.activityId)} target="_blank" rel="noopener noreferrer">
                {b.name} <ExternalLink size={12} aria-hidden="true" />
              </a>{" "}
              ({frDate(b.date)})
            </p>
            <ul className="st-vs">
              <li className={b.kmh >= BRM_MIN ? "is-ok" : "is-low"}>
                {b.kmh >= BRM_MIN ? "✓" : "✕"} Minimum d'un BRM : {num(BRM_MIN, 1)} km/h ({b.kmh >= BRM_MIN ? `+${num(b.kmh - BRM_MIN, 1)}` : num(b.kmh - BRM_MIN, 1)})
              </li>
              <li className={b.kmh >= PBP_MIN ? "is-ok" : "is-low"}>
                {b.kmh >= PBP_MIN ? "✓" : "✕"} Minimum du PBP (1 200 km en 90 h) : {num(PBP_MIN, 1)} km/h ({b.kmh >= PBP_MIN ? `+${num(b.kmh - PBP_MIN, 1)}` : num(b.kmh - PBP_MIN, 1)})
              </li>
            </ul>
          </>
        ) : (
          <p className="hint">Fais une sortie de 200 km ou plus pour la voir ici.</p>
        )}
      </div>

      {data.bestMonth && (
        <div>
          <p className="st-cap">Plus gros mois (13 derniers mois)</p>
          <p className="st-avg">
            <strong>{num(data.bestMonth.km)} km</strong> en {monthLabel(data.bestMonth.month).toLowerCase()} — {data.bestMonth.pct} % des 1 200 km du PBP
          </p>
          <div className="st-gauge" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.bestMonth.pct} aria-label="Plus gros mois comparé à 1 200 km">
            <span style={{ width: `${data.bestMonth.pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
