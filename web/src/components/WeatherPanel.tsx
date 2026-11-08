import type { CityWeather } from "../api/meteo";
import type { MeteoStatus } from "../hooks/useMeteo";

// Rendu partagé entre la météo d'un BRM saisi manuellement (ParcoursPage) et celle
// d'un BRM choisi sur le calendrier ACP (BrmChoicesOverview) — seule la source des
// données change (useMeteo vs useCatalogMeteo), pas l'affichage.
export function WeatherPanel({ status, weather }: { status: MeteoStatus; weather: CityWeather | null }) {
  if (status === "loading") return null;
  if (status === "not_configured") return null; // météo live pas activée sur ce serveur — rien à montrer
  if (status === "unavailable" || status === "error") {
    return (
      <div className="panel" style={{ background: "var(--bg)" }}>
        <p className="hint" style={{ margin: 0 }}>Météo en direct indisponible pour l'instant.</p>
      </div>
    );
  }
  if (!weather) return null;

  const next36h = weather.forecast.filter((_, i) => i % 2 === 0).slice(0, 6); // ~toutes les 6h

  return (
    <div className="panel" style={{ background: "var(--bg)" }}>
      <div className="t" style={{ fontWeight: 700, marginBottom: 10 }}>Météo — {weather.city}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="dist" style={{ fontSize: 28 }}>{weather.current.tempC}°C</div>
        <div className="hint" style={{ margin: 0 }}>
          Ressenti {weather.current.feelsLikeC}°C · {weather.current.description}
          <br />
          Vent {weather.current.windDirection} {weather.current.windSpeedKmh} km/h
          {weather.current.windGustsKmh != null && ` · rafales ${weather.current.windGustsKmh} km/h`}
        </div>
      </div>

      {next36h.length > 0 && (
        <div style={{ display: "flex", gap: 10, overflowX: "auto" }}>
          {next36h.map((slot) => (
            <div key={slot.at} style={{ flexShrink: 0, minWidth: 90, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div className="hint" style={{ margin: 0 }}>
                {new Date(slot.at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit" })}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, margin: "4px 0" }}>{slot.tempC}°C</div>
              <div className="hint" style={{ margin: 0, fontSize: 11 }}>
                {slot.windDirection} {slot.windSpeedKmh} km/h
              </div>
              {slot.precipitationProbability > 0.2 && (
                <div className="hint" style={{ margin: 0, fontSize: 11, color: "var(--accent)" }}>
                  {Math.round(slot.precipitationProbability * 100)}% pluie
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
        Prévisions à 5 jours maximum (limite de l'API) — utile à l'approche du BRM, pas pour une planification à des
        mois d'avance.
      </p>
    </div>
  );
}
