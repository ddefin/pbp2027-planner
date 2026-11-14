import { ArrowUp, Bike, CloudRain, Moon, Sun, Sunset, Thermometer, TriangleAlert, Umbrella, Wind } from "lucide-react";
import { rainPhrase } from "../../../../src/shared/onTime";
import type { LiveView, LiveWeather } from "../../api/roadbooks";
import { daylight } from "../../../../src/shared/sunTimes";
import { duration, when } from "./model";

const RELATION = {
  dos: { label: "Vent de dos", hint: "favorable", cls: "is-good" },
  face: { label: "Vent de face", hint: "défavorable", cls: "is-bad" },
  travers: { label: "Vent de travers", hint: "neutre", cls: "is-mid" },
} as const;
const ALERT: Record<string, string> = { vent_fort: "vent fort", vent_de_face: "vent de face", pluie: "pluie", froid: "froid", chaleur: "chaleur" };

function emoji(icon: string): string {
  return ({ "01": "☀️", "02": "🌤️", "03": "☁️", "04": "☁️", "09": "🌧️", "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️" } as Record<string, string>)[icon.slice(0, 2)] ?? "🌡️";
}

// Flèche du vent par rapport à sa route : vers le haut = le vent le pousse (de dos).
function WindArrow({ w, bearing }: { w: LiveWeather; bearing: number | null }) {
  if (w.windFromDeg === null || bearing === null) return null;
  const rel = (w.windFromDeg + 180 - bearing + 360) % 360;
  return (
    <span className="lv-wind-rose" aria-hidden="true">
      <Bike size={14} className="lv-wind-bike" />
      <ArrowUp size={22} style={{ transform: `rotate(${rel}deg)` }} />
    </span>
  );
}

function Slot({ w, bearing, now }: { w: LiveWeather & { hoursAhead: number }; bearing: number | null; now: Date }) {
  const rel = w.relation ? RELATION[w.relation] : null;
  return (
    <li className="lv-wx">
      <p className="lv-wx-when">
        <strong>{w.hoursAhead === 0 ? "Maintenant" : `Dans ${w.hoursAhead} h`}</strong>
        <span>{w.hoursAhead === 0 ? "au dernier pointage" : `vers le km ${Math.round(w.km)}, ${when(new Date(w.at), now)}`}</span>
      </p>
      <p className="lv-wx-main">
        <span className="lv-wx-emoji" aria-hidden="true">{emoji(w.icon)}</span>
        <span>
          <strong>{Math.round(w.tempC)}°</strong> <span className="lv-muted">ressenti {Math.round(w.feelsLikeC)}°</span>
          <br />
          {w.description}
        </span>
      </p>
      {(() => {
        const r = rainPhrase(w.rainProbability, w.rainMm);
        const RainIcon = r.level === "likely" ? Umbrella : CloudRain;
        return (
          <p className={`lv-wx-row lv-rain is-${r.level}`}>
            <RainIcon size={16} aria-hidden="true" /> <strong>{r.text}</strong>
          </p>
        );
      })()}
      <div className="lv-wx-wind">
        <WindArrow w={w} bearing={bearing} />
        <div>
          <p>
            <Wind size={16} aria-hidden="true" /> <strong>{Math.round(w.windSpeedKmh)} km/h</strong>
            {w.windGustsKmh ? <> · rafales <strong>{Math.round(w.windGustsKmh)} km/h</strong></> : null}
          </p>
          {rel && (
            <p className={`lv-rel ${rel.cls}`}>
              {rel.label} <span>({rel.hint})</span>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// Bloc 4 : météo maintenant et sur les prochaines heures, focus vent, tombée de la nuit.
export function WeatherWind({ live, position, now }: { live: LiveView | null; position: { lat: number; lon: number } | null; now: Date }) {
  const day = position ? daylight(position.lat, position.lon, now) : null;
  const alerts = [...new Set((live?.outlook ?? []).flatMap((w) => w.alerts))];
  const rains = (live?.outlook ?? []).map((w) => rainPhrase(w.rainProbability, w.rainMm).level);
  const horizon = Math.max(0, ...(live?.outlook ?? []).map((w) => w.hoursAhead));
  const rainSummary =
    rains.length === 0
      ? null
      : rains.includes("likely")
        ? { wet: true, text: horizon ? `Pluie attendue dans les ${horizon} prochaines heures` : "Il pleut ou il va pleuvoir là où il est" }
        : rains.includes("maybe")
          ? { wet: true, text: horizon ? `Averses possibles dans les ${horizon} prochaines heures` : "Averses possibles là où il est" }
          : { wet: false, text: horizon ? `Temps sec pour les ${horizon} prochaines heures` : "Pas de pluie là où il est" };
  return (
    <section className="lv-card" aria-labelledby="lv-wx-title">
      <h2 id="lv-wx-title">Météo et vent sur son secteur</h2>
      {day?.nextChange && (
        <p className={`lv-night${day.isNight ? " is-night" : ""}`}>
          {day.isNight ? <Moon size={18} aria-hidden="true" /> : <Sunset size={18} aria-hidden="true" />}
          <span>
            {day.isNight ? "Il fait nuit — lever du soleil à " : "Coucher du soleil à "}
            <strong>{when(day.nextChange, now)}</strong> (dans {duration((day.nextChange.getTime() - now.getTime()) / 60_000)})
          </span>
        </p>
      )}
      {!live ? (
        <p className="lv-empty">La météo s'affichera après le premier pointage.</p>
      ) : live.outlook.length === 0 ? (
        <p className="lv-empty">Météo indisponible pour le moment.</p>
      ) : (
        <>
          {rainSummary && (
            <p className={`lv-rain-sum${rainSummary.wet ? " is-wet" : ""}`}>
              {rainSummary.wet ? <Umbrella size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />} {rainSummary.text}
            </p>
          )}
          {alerts.length > 0 && (
            <p className="lv-alert">
              <TriangleAlert size={17} aria-hidden="true" /> Vigilance : {alerts.map((a) => ALERT[a] ?? a).join(", ")}
            </p>
          )}
          <ul className="lv-wx-list">
            {live.outlook.map((w) => (
              <Slot key={w.hoursAhead} w={w} bearing={live.sectionBearing} now={now} />
            ))}
          </ul>
          <p className="lv-foot">
            <Thermometer size={14} aria-hidden="true" /> Prévisions à l'endroit où il devrait être à son rythme. Flèche : sens du vent par rapport à sa route (vers le haut = vent dans le dos).
          </p>
        </>
      )}
    </section>
  );
}
