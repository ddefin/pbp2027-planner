import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { usePbpRoutes } from "../hooks/usePbpRoutes";
import { getPointWeather, getRouteWeather, type RouteWeather, type WeatherSlot } from "../api/pbpRoutes";
import { RouteMap } from "../components/pbp/RouteMap";
import { WeatherStrip } from "../components/pbp/WeatherStrip";
import { ControlsTable } from "../components/pbp/ControlsTable";
import { RouteManager } from "../components/pbp/RouteManager";
import { ElevationProfile } from "../components/ElevationProfile";
import { KIND_LABEL, weatherEmoji } from "../lib/pbpMeta";
import { distanceToRouteKm, etaAt, formatDuration, formatEta, pointAtKm } from "../lib/routeMath";

const DEFAULT_WAVE = "dim-17h45-90h";
const NOW = "maintenant";

// Datetime-local veut "YYYY-MM-DDTHH:mm" en heure LOCALE (pas UTC) : toISOString()
// décalerait l'heure affichée de 1 à 2h en France.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="collapsible-header" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ flex: 1 }}>
          <h2>{title}</h2>
          <span className={`collapsible-caret${open ? " open" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>
        {right}
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </section>
  );
}

export function PbpRoutePage() {
  const { user } = useAuth();
  const r = usePbpRoutes();
  const [waveId, setWaveId] = useState(DEFAULT_WAVE);
  const [customStart, setCustomStart] = useState(() => toLocalInput(new Date(Math.ceil(Date.now() / 3600_000) * 3600_000)));
  const [speed, setSpeed] = useState(15);
  const [cursorKm, setCursorKm] = useState<number | null>(null);
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [userPosition, setUserPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [here, setHere] = useState<{ place: string; slots: WeatherSlot[]; km: number; offsetKm: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const wave = r.meta?.waves.find((w) => w.id === waveId) ?? null;
  const start = waveId === NOW ? new Date(customStart).toISOString() : (wave?.start ?? new Date().toISOString());
  const points = r.primary?.points ?? [];
  const totalKm = points.length ? points[points.length - 1].distKm : 0;
  const indicative = r.primaryMeta?.kind === "indicatif";
  const hasElevation = points.some((p) => p.ele !== null);
  const finishHours = totalKm / speed;

  // Météo rechargée quand le tracé, le départ ou la vitesse changent, avec un petit
  // délai : glisser la vitesse ne doit pas déclencher une requête par cran.
  useEffect(() => {
    if (!r.primaryId || !r.meta?.weatherConfigured || points.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setWeatherLoading(true);
      getRouteWeather(r.primaryId!, { start, speed })
        .then((w) => !cancelled && setWeather(w))
        .catch(() => !cancelled && setWeather(null))
        .finally(() => !cancelled && setWeatherLoading(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [r.primaryId, r.meta?.weatherConfigured, points.length, start, speed]);

  const controlMarkers = useMemo(
    () => (r.primary?.controls ?? []).filter((c) => c.km !== null && c.services.includes("controle") && c.step > 0).map((c) => ({ km: c.km!, label: String(c.step) })),
    [r.primary],
  );

  function locateMe() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Géolocalisation non disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserPosition(p);
        const near = points.length ? distanceToRouteKm(points, p) : { km: 0, offsetKm: 0 };
        if (points.length) setCursorKm(near.km);
        if (r.meta?.weatherConfigured) {
          const w = await getPointWeather(p.lat, p.lon).catch(() => null);
          if (w) setHere({ ...w, km: near.km, offsetKm: near.offsetKm });
        }
      },
      () => setGeoError("Position refusée ou indisponible."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const cursorInfo = cursorKm !== null && points.length ? { point: pointAtKm(points, cursorKm), eta: etaAt(start, speed, cursorKm) } : null;

  return (
    <div className="wrap-wide pbp-page">
      <section className="panel">
        <div className="pbp-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 4 }}>Parcours PBP 2027</h2>
            {r.primaryMeta && (
              <div className="hint" style={{ margin: 0 }}>
                <span className={`kind-badge kind-${r.primaryMeta.kind}`}>{KIND_LABEL[r.primaryMeta.kind]}</span> {r.primaryMeta.label} ·{" "}
                <span className="tabular">
                  {Math.round(r.primaryMeta.distanceKm)} km
                  {r.primaryMeta.elevationGainM !== null && ` · D+ ${r.primaryMeta.elevationGainM.toLocaleString("fr-FR")} m`}
                </span>
              </div>
            )}
          </div>
          <button type="button" className="ghost" onClick={locateMe}>
            📍 Ma position
          </button>
        </div>
        {indicative && (
          <div className="pbp-banner">
            Le parcours détaillé 2027 n'est pas encore publié : la carte relie les villes de contrôle à vol d'oiseau. Importe un GPX
            provisoire (section « Tracés ») pour un vrai profil et un kilométrage exact.
          </div>
        )}
        {r.error && <div className="error-banner">{r.error}</div>}
        {geoError && <div className="error-banner">{geoError}</div>}

        <RouteMap
          points={points}
          indicative={indicative}
          compare={r.compare}
          controls={r.primary?.controls ?? []}
          waypoints={r.primary?.waypoints ?? []}
          weather={weather?.samples ?? []}
          cursorKm={cursorKm}
          userPosition={userPosition}
          onSelectKm={setCursorKm}
        />

        {here && (
          <div className="pbp-here">
            <strong>Ici{here.place ? ` (${here.place})` : ""}</strong>
            {here.offsetKm > 1 ? ` · à ${here.offsetKm.toFixed(1)} km du tracé, au niveau du km ${Math.round(here.km)}` : ` · km ${Math.round(here.km)}`}
            <div className="pbp-here-slots">
              {here.slots.slice(0, 6).map((s) => (
                <span key={s.at} className="tabular">
                  {new Date(s.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} {weatherEmoji(s.icon)} {s.tempC}° · {s.windSpeedKmh} km/h ·
                  💧{Math.round(s.precipitationProbability * 100)}%
                </span>
              ))}
            </div>
          </div>
        )}

        {hasElevation ? (
          <ElevationProfile points={points} cursorKm={cursorKm} markers={controlMarkers} onSelectKm={setCursorKm} showClimbList={false} />
        ) : (
          points.length > 0 &&
          !indicative && (
            <p className="hint" style={{ marginTop: 10 }}>
              Pas de profil altimétrique pour ce tracé (aucune altitude dans le GPX).
            </p>
          )
        )}
      </section>

      <Section title="Simulation de passage">
        <div className="sim-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sim-wave">Départ</label>
            <select id="sim-wave" className="cal-select" value={waveId} onChange={(e) => setWaveId(e.target.value)}>
              {(r.meta?.waves ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
              <option value={NOW}>Date libre (ex. tester la météo de cette semaine)</option>
            </select>
          </div>
          {waveId === NOW && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sim-start">Heure de départ</label>
              <input id="sim-start" type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sim-speed">Moyenne arrêts compris : {speed.toFixed(1)} km/h</label>
            <input id="sim-speed" type="range" min={10} max={30} step={0.5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </div>
        </div>
        {totalKm > 0 && (
          <p className="hint">
            Arrivée estimée {formatEta(etaAt(start, speed, totalKm))} — {formatDuration(finishHours)}
            {wave && (
              <>
                {" "}
                sur {wave.limitHours}h autorisées{" "}
                <strong style={{ color: finishHours <= wave.limitHours ? "var(--ok)" : "var(--bad)" }}>
                  ({finishHours <= wave.limitHours ? `marge ${formatDuration(wave.limitHours - finishHours)}` : `dépassement ${formatDuration(finishHours - wave.limitHours)}`})
                </strong>
                . Au délai pile : {(totalKm / wave.limitHours).toFixed(1)} km/h.
              </>
            )}
          </p>
        )}

        {totalKm > 0 && (
          <div className="km-cursor">
            <input
              type="range"
              min={0}
              max={Math.floor(totalKm)}
              step={1}
              value={cursorKm ?? 0}
              onChange={(e) => setCursorKm(Number(e.target.value))}
              aria-label="Position sur le parcours (km)"
            />
            <div className="tabular km-cursor-info">
              {cursorInfo ? (
                <>
                  km <strong>{Math.round(cursorKm!)}</strong> · passage {formatEta(cursorInfo.eta)} · {formatDuration(cursorKm! / speed)} après le départ
                  {cursorInfo.point.ele !== null && ` · ${Math.round(cursorInfo.point.ele)} m`}
                </>
              ) : (
                "Glisse le curseur (ou touche la carte / le profil) pour voir où tu seras et quand."
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="Météo le long du parcours" right={weatherLoading ? <span className="hint" style={{ margin: 0 }}>…</span> : undefined}>
        {!r.meta?.weatherConfigured ? (
          <p className="hint">Météo non configurée sur ce serveur (OPENWEATHER_API_KEY absente).</p>
        ) : weather && weather.samples.length > 0 ? (
          <>
            {weather.samples.every((s) => s.outOfRange) && (
              <div className="pbp-banner">
                Ces passages sont au-delà de l'horizon de prévision (5 jours
                {weather.horizonEnd ? `, jusqu'au ${new Date(weather.horizonEnd).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}
                ). Choisis « Date libre » pour voir la météo de cette semaine sur le parcours ; les vraies prévisions
                apparaîtront ici automatiquement à J-5 du départ.
              </div>
            )}
            <WeatherStrip samples={weather.samples} cursorKm={cursorKm} onSelectKm={setCursorKm} />
            <p className="hint" style={{ marginBottom: 0 }}>
              Prévisions OpenWeatherMap par créneaux de 3h, au point du parcours où tu devrais être à cette heure-là. Vent « de face /
              de dos » calculé sur le sens de la route à cet endroit (valeur entre parenthèses : composante qui pousse + ou freine −).
            </p>
          </>
        ) : (
          <p className="hint">{weatherLoading ? "Calcul de la météo sur le parcours…" : "Météo indisponible pour le moment."}</p>
        )}
      </Section>

      <Section title="Contrôles et accueils">
        {r.primary && (
          <ControlsTable controls={r.primary.controls} points={points} start={start} speedKmh={speed} indicative={indicative} onSelectKm={setCursorKm} />
        )}
      </Section>

      <Section title="Tracés" defaultOpen={false}>
        {r.routes && (
          <RouteManager
            routes={r.routes}
            primaryId={r.primaryId}
            compareIds={r.compareIds}
            isAdmin={Boolean(user?.isAdmin)}
            onSelectPrimary={(id) => {
              r.selectPrimary(id);
              setCursorKm(null);
            }}
            onToggleCompare={r.toggleCompare}
            onUpload={r.upload}
            onChangeKind={r.changeKind}
            onDelete={r.remove}
          />
        )}
      </Section>
    </div>
  );
}
