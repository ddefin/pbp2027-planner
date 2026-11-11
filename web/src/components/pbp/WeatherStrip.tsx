import { useEffect, useMemo, useRef } from "react";
import type { RouteWeatherSample, WeatherAlert } from "../../api/pbpRoutes";
import { ALERT_LABEL, RELATION_LABEL, weatherEmoji } from "../../lib/pbpMeta";
import { formatEta } from "../../lib/routeMath";

// Frise horizontale (défilement au doigt sur mobile) : une carte par échantillon, du
// départ à l'arrivée, à l'heure de passage estimée. La carte la plus proche du
// curseur km est mise en évidence et ramenée à l'écran.
export function WeatherStrip({
  samples,
  cursorKm,
  onSelectKm,
}: {
  samples: RouteWeatherSample[];
  cursorKm: number | null;
  onSelectKm: (km: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  const activeIdx = useMemo(() => {
    if (cursorKm === null || samples.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].km - cursorKm) < Math.abs(samples[best].km - cursorKm)) best = i;
    return best;
  }, [samples, cursorKm]);

  useEffect(() => {
    const el = stripRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIdx]);

  const alertSummary = useMemo(() => {
    const map = new Map<WeatherAlert, number[]>();
    for (const s of samples) for (const a of s.alerts) map.set(a, [...(map.get(a) ?? []), s.km]);
    return [...map.entries()];
  }, [samples]);

  return (
    <div>
      {alertSummary.length > 0 && (
        <div className="wx-alerts">
          {alertSummary.map(([alert, kms]) => (
            <button key={alert} type="button" className={`wx-alert wx-alert-${alert}`} onClick={() => onSelectKm(kms[0])}>
              {ALERT_LABEL[alert]} · km {kms.slice(0, 3).map((k) => Math.round(k)).join(", ")}
              {kms.length > 3 ? "…" : ""}
            </button>
          ))}
        </div>
      )}

      <div className="wx-strip" ref={stripRef}>
        {samples.map((s, i) => {
          const f = s.forecast;
          return (
            <button
              key={`${s.km}-${s.label}`}
              type="button"
              className={`wx-card${i === activeIdx ? " active" : ""}${s.alerts.length ? " has-alert" : ""}`}
              onClick={() => onSelectKm(s.km)}
            >
              <div className="wx-km">km {Math.round(s.km)}</div>
              <div className={`wx-place${s.isControl ? " is-control" : ""}`} title={s.label}>
                {s.isControl ? "🚨 " : ""}
                {s.label}
              </div>
              <div className="wx-eta">{formatEta(new Date(s.eta))}</div>
              {f ? (
                <>
                  <div className="wx-main">
                    <span className="wx-emoji">{weatherEmoji(f.icon)}</span>
                    <span className="wx-temp">{f.tempC}°</span>
                  </div>
                  <div className="wx-sub">ressenti {f.feelsLikeC}°</div>
                  <div className={`wx-wind wx-wind-${f.windRelation ?? "none"}`}>
                    {f.windFromDeg !== null && (
                      <span className="wx-arrow" style={{ transform: `rotate(${(f.windFromDeg + 180) % 360}deg)` }} aria-hidden="true">
                        ➤
                      </span>
                    )}
                    {f.windSpeedKmh}
                    {f.windGustsKmh ? `–${f.windGustsKmh}` : ""} km/h
                  </div>
                  {f.windRelation && (
                    <div className="wx-sub">
                      {RELATION_LABEL[f.windRelation]}
                      {f.alongWindKmh !== null && f.windRelation !== "travers" ? ` (${f.alongWindKmh > 0 ? "+" : ""}${f.alongWindKmh})` : ""}
                    </div>
                  )}
                  <div className="wx-rain" title="Probabilité de pluie sur le créneau de 3h">
                    <span className="wx-rain-bar" style={{ width: `${Math.round(f.precipitationProbability * 100)}%` }} />
                    <span className="wx-rain-txt">
                      💧 {Math.round(f.precipitationProbability * 100)}%{f.rainMm > 0 ? ` · ${f.rainMm} mm` : ""}
                    </span>
                  </div>
                </>
              ) : (
                <div className="wx-sub" style={{ marginTop: 8 }}>
                  {s.outOfRange ? "Hors horizon de prévision" : "Indisponible"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
