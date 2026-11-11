import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TrackPoint } from "../../api/brmCatalog";
import type { PbpControl, RouteWaypoint } from "../../api/pbpRoutes";
import type { RoadbookPoi, RoadbookSettings } from "../../api/roadbooks";
import { ElevationProfile } from "../ElevationProfile";
import { RouteMap } from "../pbp/RouteMap";
import { StatusPanel } from "./StatusPanel";
import { ScheduleTable } from "./ScheduleTable";
import type { LivePosition } from "./LiveTracker";
import { pointAtKm } from "../../lib/routeMath";
import {
  BRM_CLASSES,
  OFFICIAL_LIMIT_MINUTES,
  buildSchedule,
  computeLiveStatus,
  formatMinutes,
  type BrmClass,
  type PacingSettings,
} from "../../lib/roadbook";

export interface RoadbookData extends RoadbookSettings {
  pois: RoadbookPoi[];
  points: TrackPoint[];
  distanceKm: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

const SUN_KEY = "pbp.roadbook.sun";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Message affiché tant qu'il n'y a pas de statut live : formulé pour le propriétaire
// (quoi faire) ou pour un proche sur le lien de suivi (où en est-on) — un proche
// n'a que faire de "Renseigne l'heure de départ".
function waitingMessage(editable: boolean, startAt: string | null, author?: string): string {
  const who = author ?? "Le randonneur";
  if (editable) {
    return startAt
      ? "Le statut avance/retard s'affichera ici dès la première position (GPS ou pointage)."
      : "Renseigne l'heure de départ (section « Mon allure ») pour obtenir les heures de passage et le suivi avance/retard.";
  }
  if (!startAt) return `${who} n'a pas encore indiqué son heure de départ : les horaires de passage s'afficheront ici dès que ce sera fait. Le parcours et le roadbook sont déjà consultables ci-dessous.`;
  const start = new Date(startAt);
  const when = start.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return start.getTime() > Date.now()
    ? `Départ prévu ${when}. La position et l'avance/retard s'afficheront ici pendant le brevet (page actualisée chaque minute).`
    : `Parti ${when}. Pas encore de position partagée : elle apparaîtra ici dès le premier pointage (page actualisée chaque minute).`;
}

export function RoadbookView({
  data,
  position,
  editable,
  onChange,
  actions,
  live,
  author,
}: {
  data: RoadbookData;
  position: LivePosition | null;
  editable: boolean;
  onChange?: (patch: Partial<RoadbookSettings>) => void;
  actions?: ReactNode;
  live?: ReactNode;
  author?: string;
}) {
  const [selectedKm, setSelectedKm] = useState<number | null>(null);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [sun, setSun] = useState(() => {
    try {
      return localStorage.getItem(SUN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SUN_KEY, sun ? "1" : "0");
    } catch {
      // stockage indisponible : réglage non mémorisé, sans gravité
    }
  }, [sun]);

  const settings: PacingSettings = {
    movingSpeedKmh: data.movingSpeedKmh,
    climbPenaltyMinPer100m: data.climbPenaltyMinPer100m,
    classKm: data.classKm,
    limitMinutes: data.limitMinutes,
  };
  const schedule = useMemo(
    () => buildSchedule(data.controls, data.points, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.controls, data.points, data.movingSpeedKmh, data.climbPenaltyMinPer100m, data.classKm, data.limitMinutes],
  );
  const totalKm = data.points.length ? data.points[data.points.length - 1].distKm : data.distanceKm;

  const status = useMemo(() => {
    if (!position || !data.startAt) return null;
    const elapsedMin = (new Date(position.at).getTime() - new Date(data.startAt).getTime()) / 60_000;
    if (elapsedMin < 0) return null;
    return computeLiveStatus({ schedule, km: position.km, elapsedMin, settings, totalKm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, data.startAt, schedule, totalKm]);

  const finish = schedule[schedule.length - 1];
  const stopTotal = schedule.reduce((s, r) => s + r.stopMinutes, 0);

  const mapControls: PbpControl[] = useMemo(
    () =>
      [...data.controls]
        .sort((a, b) => a.km - b.km)
        .map((c, i) => {
          const p = c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon } : pointAtKm(data.points, c.km);
          return { step: i, name: c.name, lat: p.lat, lon: p.lon, km: c.km, officialKm: null, offsetKm: null, services: ["controle"] };
        }),
    [data.controls, data.points],
  );
  // Un POI déjà promu en contrôle ne doit plus apparaître deux fois.
  const pois = useMemo(
    () => data.pois.filter((p) => !data.controls.some((c) => c.name === p.name && Math.abs(c.km - p.km) < 0.2)),
    [data.pois, data.controls],
  );
  const mapPois: RouteWaypoint[] = useMemo(() => pois.map((p) => ({ ...p, offsetKm: 0 })), [pois]);

  const classValue = (BRM_CLASSES as readonly number[]).includes(data.classKm) && OFFICIAL_LIMIT_MINUTES[data.classKm as BrmClass] === data.limitMinutes ? String(data.classKm) : "custom";
  const cursorKm = hoverKm ?? selectedKm ?? position?.km ?? null;

  function addControlAt(km: number) {
    const p = pointAtKm(data.points, km);
    onChange?.({ controls: [...data.controls, { name: `Contrôle km ${Math.round(km)}`, km: Math.round(km * 10) / 10, stopMinutes: 15, lat: p.lat, lon: p.lon }] });
  }

  return (
    <div className={`wrap-wide rb-page${sun ? " sun-mode" : ""}`}>
      <section className="panel">
        <div className="pbp-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 4 }}>{data.title}</h2>
            <div className="rb-stats tabular">
              <span>{data.distanceKm.toFixed(1)} km</span>
              {data.elevationGainM !== null && <span>D+ {data.elevationGainM.toLocaleString("fr-FR")} m</span>}
              {data.elevationLossM !== null && <span>D− {data.elevationLossM.toLocaleString("fr-FR")} m</span>}
              <span>
                BRM {data.classKm} · délai {formatMinutes(data.limitMinutes)}
              </span>
              {author && <span>par {author}</span>}
            </div>
          </div>
          <button type="button" className="ghost no-print" onClick={() => setSun((v) => !v)} aria-pressed={sun} title="Contraste maximal pour lire en plein soleil">
            {sun ? "🌙 Normal" : "☀️ Plein soleil"}
          </button>
        </div>

        {data.liveTrackUrl && (
          <a className="rb-livetrack no-print" href={data.liveTrackUrl} target="_blank" rel="noreferrer">
            📡 Position en direct sur Garmin LiveTrack ↗
          </a>
        )}

        {status ? (
          <StatusPanel status={status} startAt={data.startAt} asOf={position?.at} />
        ) : (
          <div className={editable ? "hint no-print" : "rb-viewer-note no-print"}>{waitingMessage(editable, data.startAt, author)}</div>
        )}

        {live && <div className="no-print">{live}</div>}

        <div className="no-print rb-map">
          <RouteMap
            points={data.points}
            indicative={false}
            compare={[]}
            controls={mapControls}
            waypoints={mapPois}
            weather={[]}
            cursorKm={cursorKm}
            userPosition={position?.lat != null && position.lon != null ? { lat: position.lat, lon: position.lon } : null}
            onSelectKm={setSelectedKm}
          />
        </div>
        <ElevationProfile
          points={data.points}
          cursorKm={cursorKm}
          markers={schedule.slice(1, -1).map((r, i) => ({ km: r.km, label: String(i + 1) }))}
          onSelectKm={setSelectedKm}
          onHoverPoint={(p) => setHoverKm(p ? p.distKm : null)}
          showClimbList={false}
        />
        {editable && selectedKm !== null && (
          <div className="no-print" style={{ marginTop: 8 }}>
            <button type="button" className="ghost" onClick={() => addControlAt(selectedKm)}>
              ＋ Ajouter un contrôle au km {Math.round(selectedKm)}
            </button>
          </div>
        )}
      </section>

      {editable && onChange && (
        <section className="panel no-print">
          <h2>Mon allure</h2>
          <div className="sim-grid">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rb-class">Brevet</label>
              <select
                id="rb-class"
                className="cal-select"
                value={classValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") onChange({ classKm: Math.round(data.distanceKm), limitMinutes: data.limitMinutes });
                  else onChange({ classKm: Number(v), limitMinutes: OFFICIAL_LIMIT_MINUTES[Number(v) as BrmClass] });
                }}
              >
                {BRM_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    BRM {c} km — {formatMinutes(OFFICIAL_LIMIT_MINUTES[c])}
                  </option>
                ))}
                <option value="custom">Sur-mesure</option>
              </select>
            </div>
            {classValue === "custom" && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Distance nominale / délai</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="rb-input rb-input-num"
                    type="number"
                    min={50}
                    max={1300}
                    value={data.classKm}
                    onChange={(e) => onChange({ classKm: Math.max(50, Math.min(1300, Math.round(Number(e.target.value) || 50))) })}
                    aria-label="Distance nominale (km)"
                  />
                  km en
                  <input
                    className="rb-input rb-input-num"
                    type="number"
                    min={1}
                    max={100}
                    step={0.5}
                    value={data.limitMinutes / 60}
                    onChange={(e) => onChange({ limitMinutes: Math.max(60, Math.min(6000, Math.round((Number(e.target.value) || 1) * 60))) })}
                    aria-label="Délai (heures)"
                  />
                  h
                </div>
              </div>
            )}
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rb-start">Départ</label>
              <input
                id="rb-start"
                type="datetime-local"
                value={toLocalInput(data.startAt)}
                onChange={(e) => onChange({ startAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rb-speed">Vitesse roulée (hors arrêts) : {data.movingSpeedKmh.toFixed(1)} km/h</label>
              <input id="rb-speed" type="range" min={12} max={35} step={0.5} value={data.movingSpeedKmh} onChange={(e) => onChange({ movingSpeedKmh: Number(e.target.value) })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rb-climb">Montées : +{data.climbPenaltyMinPer100m} min / 100 m D+</label>
              <input
                id="rb-climb"
                type="range"
                min={0}
                max={15}
                step={1}
                value={data.climbPenaltyMinPer100m}
                onChange={(e) => onChange({ climbPenaltyMinPer100m: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            La pénalité de montée corrige une vitesse moyenne « de plat » : 0 si ta vitesse tient déjà compte du relief, 3 à 6 min
            par 100 m pour un parcours vallonné.{" "}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                const v = Number(prompt("Pause à appliquer à tous les contrôles intermédiaires (minutes) :", "15"));
                if (Number.isFinite(v) && v >= 0) onChange({ controls: data.controls.map((c, i, arr) => (i === 0 || i === arr.length - 1 ? c : { ...c, stopMinutes: Math.round(v) })) });
              }}
            >
              Même pause partout…
            </button>
          </p>
        </section>
      )}

      <section className="panel rb-roadbook">
        <div className="print-only rb-print-head">
          <strong>{data.title}</strong> — {data.distanceKm.toFixed(1)} km, D+ {data.elevationGainM ?? "?"} m · BRM {data.classKm} ({formatMinutes(data.limitMinutes)}) · départ{" "}
          {data.startAt ? new Date(data.startAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" }) : "non renseigné"} · {data.movingSpeedKmh} km/h roulés
        </div>
        <h2>Roadbook</h2>
        {finish && (
          <div className="rb-summary tabular">
            <div>
              <span>Arrivée prévue</span>
              <strong>{data.startAt ? new Date(new Date(data.startAt).getTime() + finish.arriveMin * 60_000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : `+${formatMinutes(finish.arriveMin)}`}</strong>
            </div>
            <div>
              <span>Temps total</span>
              <strong>{formatMinutes(finish.arriveMin)}</strong>
            </div>
            <div>
              <span>Dont arrêts</span>
              <strong>{formatMinutes(stopTotal)}</strong>
            </div>
            <div>
              <span>Moyenne générale</span>
              <strong>{finish.arriveMin > 0 ? ((totalKm / finish.arriveMin) * 60).toFixed(1) : "—"} km/h</strong>
            </div>
            <div>
              <span>Marge sur le délai</span>
              <strong className={`lvl-text-${finish.marginMin < 0 ? "late" : finish.marginMin < 45 ? "tight" : "ok"}`}>{formatMinutes(finish.marginMin)}</strong>
            </div>
          </div>
        )}
        <ScheduleTable
          schedule={schedule}
          controls={data.controls}
          startAt={data.startAt}
          passedKm={position?.km ?? null}
          editable={editable}
          onChange={(controls) => onChange?.({ controls })}
          onSelectKm={setSelectedKm}
        />
        <p className="hint" style={{ marginBottom: 0 }}>
          Ouverture/fermeture : barème ACP (34→28 km/h et 15 km/h ; 20 km/h + 1 h jusqu'au km 60 ; délai officiel à l'arrivée).
          La carte de route de l'organisateur fait foi.
        </p>

        {editable && pois.length > 0 && (
          <div className="no-print" style={{ marginTop: 14 }}>
            <div className="hint" style={{ fontWeight: 700, margin: "0 0 6px" }}>
              Points d'intérêt du GPX
            </div>
            <div className="rb-pois">
              {pois.map((p, i) => (
                <div key={`${p.km}-${i}`} className="rb-poi">
                  <span>
                    <strong>{p.name}</strong> · km {Math.round(p.km)}
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onChange?.({ controls: [...data.controls, { name: p.name, km: p.km, stopMinutes: 15, lat: p.lat, lon: p.lon }] })}
                  >
                    → contrôle
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {actions && <section className="panel no-print">{actions}</section>}
    </div>
  );
}
