import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TrackPoint } from "../../api/brmCatalog";
import type { PbpControl, RouteWaypoint } from "../../api/pbpRoutes";
import type { RoadbookPoi, RoadbookSettings } from "../../api/roadbooks";
import { Disclosure } from "../Disclosure";
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

export type TabId = "suivi" | "roadbook" | "reglages" | "partage";

// Contenus propres à chaque page (propriétaire / lien de suivi) injectés dans les onglets.
// La présence de `sharing` fait apparaître l'onglet Partage ; l'onglet Réglages dépend
// de `editable`.
export interface RoadbookSlots {
  saveStatus?: ReactNode;
  pointage?: ReactNode;
  quickShare?: (goTo: (tab: TabId) => void) => ReactNode;
  roadbookActions?: ReactNode;
  settingsFooter?: ReactNode;
  sharing?: ReactNode;
}

const TAB_LABEL: Record<TabId, string> = { suivi: "📍 Suivi", roadbook: "📋 Roadbook", reglages: "⚙️ Réglages", partage: "📣 Partage" };

// Onglet d'ouverture : l'adresse (#partage…) si elle en désigne un, sinon celui dont on a
// le plus probablement besoin. Une personne qui suit un proche arrive sur le suivi ; le
// propriétaire sur les réglages tant que le départ n'est pas renseigné, sur le roadbook
// pour préparer, et sur le suivi à l'approche du départ et pendant le brevet.
function initialTab(available: TabId[], editable: boolean, startAt: string | null): TabId {
  const fromHash = window.location.hash.slice(1) as TabId;
  if (available.includes(fromHash)) return fromHash;
  if (!editable) return "suivi";
  if (!startAt) return "reglages";
  return Date.now() >= new Date(startAt).getTime() - 3 * 3600_000 ? "suivi" : "roadbook";
}

export function RoadbookView({
  data,
  position,
  editable,
  onChange,
  slots,
  author,
}: {
  data: RoadbookData;
  position: LivePosition | null;
  editable: boolean;
  onChange?: (patch: Partial<RoadbookSettings>) => void;
  slots?: RoadbookSlots;
  author?: string;
}) {
  const available: TabId[] = ["suivi", "roadbook", ...(editable && onChange ? (["reglages"] as TabId[]) : []), ...(slots?.sharing ? (["partage"] as TabId[]) : [])];
  const [tab, setTabState] = useState<TabId>(() => initialTab(available, editable, data.startAt));
  const [mapMounted, setMapMounted] = useState(tab === "suivi");
  const tabsRef = useRef<HTMLElement>(null);

  function goTo(next: TabId) {
    setTabState(next);
    if (next === "suivi") setMapMounted(true);
    // Mémorisé dans l'adresse (rechargement, retour arrière, lien direct) sans toucher à
    // l'état interne du routeur.
    window.history.replaceState(window.history.state, "", `#${next}`);
    // Une barre collée en haut + un nouvel onglet plus court : on remonte au début du
    // contenu plutôt que de laisser la page "sauter" plus bas que ce qui existe.
    const bar = tabsRef.current;
    if (bar) {
      const top = bar.getBoundingClientRect().top + window.scrollY - 8;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
    }
  }

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

  const stopLine = (
    <div className="rb-stats tabular">
      <span>{data.distanceKm.toFixed(1)} km</span>
      {data.elevationGainM !== null && <span>D+ {data.elevationGainM.toLocaleString("fr-FR")} m</span>}
      {data.elevationLossM !== null && <span>D− {data.elevationLossM.toLocaleString("fr-FR")} m</span>}
      <span>
        BRM {data.classKm} · délai {formatMinutes(data.limitMinutes)}
      </span>
      {author && <span>par {author}</span>}
    </div>
  );

  // Chaque panneau reste dans le DOM même masqué : l'impression (PDF) en a besoin quel
  // que soit l'onglet actif, et les états (carte, profil) ne sont pas perdus en changeant
  // d'onglet. `print-keep` = le panneau fait partie de l'impression.
  const panel = (id: TabId, printKeep: boolean, children: ReactNode) => (
    <div
      id={`rb-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`rb-tab-${id}`}
      className={`rb-tabpanel${tab === id ? "" : " is-hidden"}${printKeep ? " print-keep" : ""}`}
    >
      {children}
    </div>
  );

  return (
    <div className={`wrap-wide rb-page${sun ? " sun-mode" : ""}`}>
      <section className="panel rb-header">
        <div className="pbp-head" style={{ marginBottom: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 4 }}>{data.title}</h2>
            {stopLine}
            {slots?.saveStatus && <div className="rb-save-line no-print">{slots.saveStatus}</div>}
          </div>
          <button type="button" className="ghost no-print" onClick={() => setSun((v) => !v)} aria-pressed={sun} title="Contraste maximal pour lire en plein soleil">
            {sun ? "🌙 Normal" : "☀️ Plein soleil"}
          </button>
        </div>
      </section>

      <nav className="rb-tabs no-print" role="tablist" aria-label="Sections du roadbook" ref={tabsRef}>
        {available.map((id) => (
          <button
            key={id}
            id={`rb-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`rb-panel-${id}`}
            className="rb-tab"
            onClick={() => goTo(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </nav>

      {/* ───── Suivi : statut, pointage, partage rapide, carte, profil ───── */}
      {panel(
        "suivi",
        true,
        <section className="panel">
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

          {slots?.pointage && <div className="no-print rb-block">{slots.pointage}</div>}
          {slots?.quickShare && <div className="no-print rb-block">{slots.quickShare(goTo)}</div>}

          {mapMounted && (
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
          )}
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
              <span className="hint" style={{ marginLeft: 8 }}>
                (onglet Roadbook pour régler sa pause)
              </span>
            </div>
          )}
        </section>,
      )}

      {/* ───── Roadbook : le plan de marche, c'est ce qui s'imprime ───── */}
      {panel(
        "roadbook",
        true,
        <section className="panel rb-roadbook">
          <div className="print-only rb-print-head">
            <strong>{data.title}</strong> — {data.distanceKm.toFixed(1)} km, D+ {data.elevationGainM ?? "?"} m · BRM {data.classKm} ({formatMinutes(data.limitMinutes)}) · départ{" "}
            {data.startAt ? new Date(data.startAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" }) : "non renseigné"} · {data.movingSpeedKmh} km/h roulés
          </div>
          <div className="rb-section-head">
            <h2>Roadbook</h2>
            {slots?.roadbookActions && <div className="rb-section-actions no-print">{slots.roadbookActions}</div>}
          </div>
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
        </section>,
      )}

      {/* ───── Réglages : brevet, départ, allure ───── */}
      {editable &&
        onChange &&
        panel(
          "reglages",
          false,
          <section className="panel no-print">
            <Disclosure
              title="🏷️ Brevet et départ"
              summary={
                data.startAt
                  ? `BRM ${data.classKm} · départ ${new Date(data.startAt).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : "⚠ Heure de départ à renseigner"
              }
              tone={data.startAt ? "muted" : "warn"}
              storageKey="rb.reglages.brevet"
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rb-title">Nom du roadbook (affiché aux proches et sur le canal Telegram)</label>
                <input
                  id="rb-title"
                  value={data.title}
                  maxLength={100}
                  onChange={(e) => onChange({ title: e.target.value })}
                  onBlur={(e) => {
                    if (!e.target.value.trim()) onChange({ title: "Mon BRM" });
                  }}
                />
              </div>
              <div className="sim-grid">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="rb-class">Type de brevet</label>
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
                        value={Math.round((data.limitMinutes / 60) * 100) / 100}
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
              </div>
            </Disclosure>

            <Disclosure
              title="🚴 Mon allure"
              summary={`${data.movingSpeedKmh.toFixed(1)} km/h roulés${data.climbPenaltyMinPer100m ? ` · +${data.climbPenaltyMinPer100m} min / 100 m D+` : ""}`}
              storageKey="rb.reglages.allure"
            >
              <div className="sim-grid">
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
              <p className="hint" style={{ margin: 0 }}>
                La pénalité de montée corrige une vitesse moyenne « de plat » : 0 si ta vitesse tient déjà compte du relief, 3 à 6 min
                par 100 m pour un parcours vallonné.
              </p>
              <div className="rb-card-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const v = Number(prompt("Pause à appliquer à tous les contrôles intermédiaires (minutes) :", "15"));
                    if (Number.isFinite(v) && v >= 0) onChange({ controls: data.controls.map((c, i, arr) => (i === 0 || i === arr.length - 1 ? c : { ...c, stopMinutes: Math.round(v) })) });
                  }}
                >
                  Même pause à tous les contrôles…
                </button>
                <button type="button" className="linklike" onClick={() => goTo("roadbook")}>
                  Régler les pauses une par une → Roadbook
                </button>
              </div>
            </Disclosure>

            {slots?.settingsFooter}
          </section>,
        )}

      {/* ───── Partage : lien de suivi, WhatsApp, Telegram, LiveTrack ───── */}
      {slots?.sharing && panel("partage", false, <section className="panel no-print">{slots.sharing}</section>)}
    </div>
  );
}
