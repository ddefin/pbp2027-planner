import { useEffect, useRef } from "react";
import { CalendarClock, CalendarDays, Route, Search, SearchX, X } from "lucide-react";
import { DistanceBadge } from "../components/groupBrm/DistanceBadge";
import { StatusPicker } from "../components/groupBrm/StatusPicker";
import { TimelineView } from "../components/groupBrm/TimelineView";
import { dayLabel, GROUP_DISTANCES } from "../components/groupBrm/model";
import { useCalendarFilters } from "../components/groupBrm/useCalendarFilters";
import { useBrmCatalog } from "../hooks/useBrmCatalog";
import { daysUntil } from "../lib/brmMeta";

// Calendrier officiel des BRM : même présentation que « BRM choisis par le groupe »
// (composants gb-*), avec en plus le choix de son propre statut sur chaque ligne.
export function CalendrierPage() {
  const { events, loading, error, choose, clear } = useBrmCatalog();
  const f = useCalendarFilters(events);
  const barRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Hauteur de la barre collante : les titres de mois se collent juste en dessous.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !sectionRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => sectionRef.current?.style.setProperty("--gb-bar-h", `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, [loading]);

  const next = f.stats.next;
  const j = next ? daysUntil(next.date) : null;
  const n = f.visible.length;

  return (
    <div className="wrap-wide">
      <section className="panel gb gb-cal" ref={sectionRef} aria-labelledby="cal-title">
        <div className="gb-title-row">
          <h2 id="cal-title">Calendrier des BRM</h2>
          <span className="gb-muted gb-cal-sub">France · janvier à juin 2027 · source Audax Club Parisien</span>
        </div>
        <p className="hint">
          Appuie sur « Choisir » pour les brevets que tu comptes faire, puis mets ton statut à jour (Inscrit, Fait,
          Homologué). Tes choix sont visibles par le groupe et alimentent ton compteur de qualification.
        </p>

        {error && <div className="error-banner">{error}</div>}
        {loading && (
          <div className="gb-skel" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} />
            ))}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="gb-stats">
              <div className="gb-stat">
                <CalendarDays size={18} aria-hidden="true" />
                <div>
                  <strong className="gb-num">{f.stats.total}</strong>
                  <span>BRM à venir</span>
                </div>
              </div>
              <div className="gb-stat gb-stat-next">
                <CalendarClock size={18} aria-hidden="true" />
                <div>
                  {next ? (
                    <>
                      <span>Mon prochain départ</span>
                      <strong>
                        {dayLabel(next.date)} <span className="gb-j">{j === 0 ? "aujourd'hui" : `J-${j}`}</span>
                      </strong>
                      <span>
                        <DistanceBadge distance={next.distance} /> {next.ville}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>—</strong>
                      <span>Mon prochain départ : aucun BRM choisi</span>
                    </>
                  )}
                </div>
              </div>
              <div className="gb-stat">
                <Route size={18} aria-hidden="true" />
                <div>
                  <strong className="gb-num">{f.stats.mine}</strong>
                  <span>
                    {f.stats.mine > 1 ? "BRM choisis" : "BRM choisi"} ·{" "}
                    <button type="button" className="gb-linkbtn" onClick={() => f.setMineOnly(!f.mineOnly)}>
                      {f.mineOnly ? "tout voir" : "voir"}
                    </button>
                  </span>
                </div>
              </div>
            </div>

            <div className="gb-cal-filters">
              <div className="gb-bar-row gb-cal-fields">
                <label className="gb-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Ville, club ou département"
                    aria-label="Rechercher une ville, un club ou un département"
                    value={f.search}
                    onChange={(e) => f.setSearch(e.target.value)}
                  />
                </label>
                <select className="gb-select" value={f.region} onChange={(e) => f.setRegion(e.target.value)} aria-label="Filtrer par région">
                  <option value="">Toutes les régions</option>
                  {f.regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="gb-bar-row gb-cal-switches">
                <label className="gb-switch">
                  <input type="checkbox" checked={f.mineOnly} onChange={(e) => f.setMineOnly(e.target.checked)} />
                  <span>Mes BRM seulement</span>
                </label>
                <label className="gb-switch">
                  <input type="checkbox" checked={!f.showPast} onChange={(e) => f.setShowPast(!e.target.checked)} />
                  <span>Masquer les passés</span>
                </label>
              </div>
            </div>

            <div ref={barRef} className="gb-bar-wrap">
              <div className="gb-bar" role="region" aria-label="Filtres du calendrier">
                <div className="gb-bar-row">
                  <div className="gb-pills" role="group" aria-label="Distance">
                    <button type="button" className="gb-pill" aria-pressed={f.dist === null} onClick={() => f.setDist(null)}>
                      Tous
                    </button>
                    {GROUP_DISTANCES.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`gb-pill gb-pill-${d}`}
                        aria-pressed={f.dist === d}
                        onClick={() => f.setDist(f.dist === d ? null : d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gb-bar-foot" aria-live="polite">
                  <span>
                    {n} BRM affiché{n > 1 ? "s" : ""}
                  </span>
                  {f.filtered && (
                    <button type="button" className="gb-reset" onClick={f.reset}>
                      <X size={13} aria-hidden="true" /> Effacer les filtres
                    </button>
                  )}
                </div>
              </div>
            </div>

            {n > 0 ? (
              <TimelineView
                events={f.visible}
                today={f.today}
                highlight={null}
                renderAction={(ev) => (
                  <StatusPicker
                    status={ev.myStatus}
                    label={`BRM ${ev.distance} ${ev.ville}, ${dayLabel(ev.date)}`}
                    onChoose={(s) => choose(ev.id, s)}
                    onClear={() => clear(ev.id)}
                  />
                )}
              />
            ) : (
              <div className="gb-empty">
                <SearchX size={22} aria-hidden="true" />
                <strong>{f.mineOnly && f.stats.mine === 0 ? "Tu n'as encore choisi aucun BRM" : "Aucun BRM ne correspond"}</strong>
                {f.filtered && (
                  <button type="button" className="gb-reset" onClick={f.reset}>
                    Effacer les filtres
                  </button>
                )}
              </div>
            )}

            {f.hiddenPast > 0 && (
              <p className="gb-past-note">
                {f.hiddenPast} BRM passé{f.hiddenPast > 1 ? "s" : ""} masqué{f.hiddenPast > 1 ? "s" : ""} ·{" "}
                <button type="button" className="gb-linkbtn" onClick={() => f.setShowPast(true)}>
                  afficher
                </button>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
