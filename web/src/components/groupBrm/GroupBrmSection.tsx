import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { SearchX } from "lucide-react";
import { useBrmCatalog } from "../../hooks/useBrmCatalog";
import { FilterBar } from "./FilterBar";
import { MemberView } from "./MemberView";
import { SummaryStats } from "./SummaryStats";
import { TimelineView } from "./TimelineView";
import { useGroupBrmFilters } from "./useGroupBrmFilters";

// « BRM choisis par le groupe » (tableau de bord) : indicateurs, filtres collants,
// vue chronologique ou par randonneur. Données : choix faits sur le calendrier.
export function GroupBrmSection() {
  const { events, loading, error } = useBrmCatalog();
  const f = useGroupBrmFilters(events);
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

  const members = f.selectedMember ? [f.selectedMember] : f.members;
  return (
    <section className="panel gb" ref={sectionRef} aria-labelledby="gb-title">
      <div className="gb-title-row">
        <h2 id="gb-title">BRM choisis par le groupe</h2>
        <Link to="/calendrier" className="gb-cal-link">
          Calendrier →
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && (
        <div className="gb-skel" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} />
          ))}
        </div>
      )}
      {!loading && !error && f.chosen.length === 0 && (
        <p className="hint">
          Personne n'a encore choisi de BRM — rendez-vous sur le <Link to="/calendrier">calendrier</Link> pour s'inscrire.
        </p>
      )}

      {!loading && f.chosen.length > 0 && (
        <>
          <SummaryStats {...f.stats} />
          <div ref={barRef} className="gb-bar-wrap">
            <FilterBar
              view={f.view}
              onView={f.setView}
              dist={f.dist}
              onDist={f.setDist}
              members={f.members}
              member={f.member}
              onMember={f.setMember}
              showPast={f.showPast}
              onShowPast={f.setShowPast}
              countLabel={
                f.view === "chrono"
                  ? `${f.visible.length} BRM affiché${f.visible.length > 1 ? "s" : ""}`
                  : `${members.length} randonneur${members.length > 1 ? "s" : ""}`
              }
              filtered={f.filtered}
              onReset={f.reset}
            />
          </div>

          {f.view === "chrono" ? (
            f.visible.length > 0 ? (
              <TimelineView events={f.visible} today={f.today} highlight={f.member} />
            ) : (
              <div className="gb-empty">
                <SearchX size={22} aria-hidden="true" />
                <strong>Aucun BRM ne correspond</strong>
                <button type="button" className="gb-reset" onClick={f.reset}>
                  Effacer les filtres
                </button>
              </div>
            )
          ) : (
            <MemberView members={members} dist={f.dist} showPast={f.showPast} today={f.today} />
          )}

          {f.view === "chrono" && f.hiddenPast > 0 && (
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
  );
}
