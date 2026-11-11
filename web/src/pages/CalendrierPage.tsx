import { useMemo, useState } from "react";
import type { CatalogEvent } from "../api/brmCatalog";
import { Disclosure } from "../components/Disclosure";
import { useBrmCatalog } from "../hooks/useBrmCatalog";
import { ACP_CALENDAR_URL, CATALOG_STATUS_LABEL, CATALOG_STATUS_OPTIONS, VALID_DISTANCES } from "../lib/brmMeta";

const MONTH_LABEL = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

function monthKey(date: string) {
  return date.slice(0, 7); // yyyy-mm
}

function monthLabel(date: string) {
  const [year, month] = date.split("-");
  return `${MONTH_LABEL[Number(month) - 1]} ${year}`;
}

export function CalendrierPage() {
  const { events, loading, error, choose, clear } = useBrmCatalog();
  const [search, setSearch] = useState("");
  const [distances, setDistances] = useState<Set<number>>(new Set());
  const [region, setRegion] = useState("");

  // Filtres repliés sur téléphone (ils occupaient un écran entier avant la liste) ; le
  // résumé rappelle ce qui est actif.
  const activeFilters = (distances.size > 0 ? 1 : 0) + (region ? 1 : 0) + (search.trim() ? 1 : 0);
  const filterSummary = [
    activeFilters > 0 ? `${activeFilters} filtre${activeFilters > 1 ? "s" : ""} actif${activeFilters > 1 ? "s" : ""}` : "Aucun filtre",
    distances.size > 0 ? `${[...distances].sort((a, b) => a - b).join(", ")} km` : null,
    region || null,
    search.trim() ? `« ${search.trim()} »` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const regions = useMemo(() => {
    const set = new Set((events ?? []).map((e) => e.region).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      if (distances.size > 0 && !distances.has(e.distance)) return false;
      if (region && e.region !== region) return false;
      if (term && !`${e.ville} ${e.club}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [events, search, distances, region]);

  const groups = useMemo(() => {
    const map = new Map<string, CatalogEvent[]>();
    for (const e of filtered) {
      const key = monthKey(e.date);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggleDistance(d: number) {
    setDistances((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  return (
    <div className="wrap-wide">
      <section className="panel">
        <h2>Calendrier des BRM — France, janvier à juin 2027</h2>
        <p className="hint">
          Source : calendrier officiel de l'Audax Club Parisien. Choisis les brevets que tu comptes faire — ton
          statut est visible par les autres randonneurs connectés.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <Disclosure title="Filtres" summary={filterSummary} storageKey="calendrier.filtres">
        <div className="cal-filters">
          <div className="cal-chips">
            <button type="button" className={`cal-chip${distances.size === 0 ? " active" : ""}`} onClick={() => setDistances(new Set())}>
              Toutes distances
            </button>
            {VALID_DISTANCES.map((d) => (
              <button
                key={d}
                type="button"
                className={`cal-chip${distances.has(d) ? " active" : ""}`}
                onClick={() => toggleDistance(d)}
              >
                {d} km
              </button>
            ))}
          </div>
          <select className="cal-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Toutes régions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            className="cal-search"
            type="search"
            placeholder="Rechercher une ville ou un club…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        </Disclosure>

        {loading && <p className="hint">Chargement du calendrier…</p>}
        {!loading && !error && filtered.length === 0 && <p className="hint">Aucun BRM ne correspond à ces critères.</p>}

        {!loading &&
          groups.map(([key, items]) => (
            <div key={key}>
              <div className="cal-month">{monthLabel(key)}</div>
              {items.map((ev) => (
                <CatalogRow key={ev.id} event={ev} onChoose={(status) => choose(ev.id, status)} onClear={() => clear(ev.id)} />
              ))}
            </div>
          ))}
      </section>
    </div>
  );
}

function CatalogRow({
  event,
  onChoose,
  onClear,
}: {
  event: CatalogEvent;
  onChoose: (status: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="cal-row">
      <div className="cal-date tabular">{event.date.slice(8, 10)}/{event.date.slice(5, 7)}</div>
      <div className="cal-main">
        <span className="cal-dist">{event.distance}</span>
        <span className="cal-ville">{event.ville}</span>
        <div className="cal-sub">
          {event.club}
          {event.departement ? ` · ${event.departement}` : ""}
          {event.roadMap && (
            <>
              {" · "}
              <a href={event.roadMap} target="_blank" rel="noreferrer">Parcours</a>
            </>
          )}
          {" · "}
          <a href={event.siteWeb || ACP_CALENDAR_URL} target="_blank" rel="noreferrer">Inscription</a>
        </div>
      </div>
      <div className="cal-participants">
        {event.participants.map((p, i) => (
          <span key={i} className="cal-pname">
            {p.displayName} · {CATALOG_STATUS_LABEL[p.status as keyof typeof CATALOG_STATUS_LABEL] ?? p.status}
          </span>
        ))}
      </div>
      <select
        value={event.myStatus ?? ""}
        onChange={(e) => {
          if (e.target.value === "") onClear();
          else onChoose(e.target.value);
        }}
      >
        <option value="">Non choisi</option>
        {CATALOG_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {CATALOG_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
