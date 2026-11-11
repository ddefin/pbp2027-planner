import type { LiveView } from "../../api/roadbooks";
import { formatMinutes } from "../../lib/roadbook";

const REL: Record<string, string> = { dos: "dans le dos", face: "de face", travers: "de travers" };
const ALERT: Record<string, string> = { vent_fort: "💨 vent fort", vent_de_face: "🌬️ vent de face", pluie: "🌧️ pluie", froid: "🥶 froid", chaleur: "🥵 chaleur" };
const emoji = (c: string) => ({ "01": "☀️", "02": "🌤️", "03": "☁️", "04": "☁️", "09": "🌧️", "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️" } as Record<string, string>)[c.slice(0, 2)] ?? "🌡️";
const t = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

// Page de suivi des proches : l'essentiel en un coup d'œil — où il en est, à quelle heure
// il devrait arriver, s'il est dans les temps, et le temps qu'il va faire devant lui.
export function LiveCard({ live }: { live: LiveView }) {
  const ahead = live.weather.filter((w) => w.label !== "Maintenant");
  const now = live.weather.find((w) => w.label === "Maintenant");
  const barrier =
    live.barrierMarginMin === null
      ? null
      : live.barrierLevel === "late"
        ? { cls: "late", text: "⚠️ Barrière horaire en danger" }
        : live.barrierLevel === "tight"
          ? { cls: "tight", text: `Barrière : ${formatMinutes(live.barrierMarginMin)} de marge` }
          : { cls: "ok", text: `Dans les temps · ${formatMinutes(live.barrierMarginMin)} de marge` };
  return (
    <section className="panel rb-live no-print">
      <h2 style={{ marginTop: 0 }}>{live.finished ? "🏁 Arrivé !" : "En ce moment"}</h2>
      <div className="rb-summary tabular">
        <div>
          <span>Parcourus</span>
          <strong>
            {Math.round(live.km)} / {Math.round(live.totalKm)} km
          </strong>
        </div>
        {!live.finished && (
          <div>
            <span>Restants</span>
            <strong>{Math.round(live.kmLeft)} km</strong>
          </div>
        )}
        {live.place && (
          <div>
            <span>Près de</span>
            <strong>{live.place}</strong>
          </div>
        )}
        {live.plannedFinishAt && (
          <div>
            <span>Arrivée prévue</span>
            <strong>{t(live.plannedFinishAt)}</strong>
          </div>
        )}
        {live.paceFinishAt && (
          <div>
            <span>Au rythme actuel</span>
            <strong>{t(live.paceFinishAt)}</strong>
          </div>
        )}
        {live.limitAt && (
          <div>
            <span>Délai maximum</span>
            <strong>{t(live.limitAt)}</strong>
          </div>
        )}
      </div>
      {barrier && !live.finished && <p className={`lvl-text-${barrier.cls}`} style={{ fontWeight: 700 }}>{barrier.text}</p>}
      {live.nextControl && !live.finished && (
        <p>
          <strong>Prochain contrôle :</strong> {live.nextControl.name} (km {Math.round(live.nextControl.km)}){live.nextControl.eta ? ` — vers ${t(live.nextControl.eta)}` : ""}
          {live.nextControl.closeAt ? ` · ferme ${t(live.nextControl.closeAt)}` : ""}
        </p>
      )}
      {(now || ahead.length > 0) && (
        <div className="rb-live-weather">
          {[...(now ? [now] : []), ...ahead].map((w) => (
            <div key={`${w.label}-${w.km}`} className="rb-live-w">
              <strong>{w.label === "Maintenant" ? "Maintenant" : `${w.label} · vers ${t(w.at)}`}</strong>
              <span>
                {emoji(w.icon)} {w.tempC}° (ressenti {w.feelsLikeC}°), {w.description}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                💨 {w.windSpeedKmh} km/h{w.relation ? ` ${REL[w.relation]}` : ""} · 💧 {Math.round(w.rainProbability * 100)} %
                {w.alerts.length ? ` · ${w.alerts.map((a) => ALERT[a] ?? a).join(", ")}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
