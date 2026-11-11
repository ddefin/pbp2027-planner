import { useMemo, useState } from "react";
import type { NewsItem, NewsSource } from "../api/news";
import { useNews } from "../hooks/useNews";

const SOURCE_LABEL: Record<NewsSource, string> = {
  acp: "Audax Club Parisien",
  pbp: "Paris-Brest-Paris",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "jamais";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffHours < 1) return "il y a moins d'une heure";
  if (diffHours < 24) return `il y a ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `il y a ${diffDays} jour${diffDays > 1 ? "s" : ""}`;
}

function NewsSkeletonCard() {
  return (
    <div className="news-card news-card-skeleton" aria-hidden="true">
      <div className="news-skel news-skel-img" />
      <div className="news-skel news-skel-line" style={{ width: "40%" }} />
      <div className="news-skel news-skel-line" style={{ width: "90%", height: 18 }} />
      <div className="news-skel news-skel-line" style={{ width: "100%" }} />
      <div className="news-skel news-skel-line" style={{ width: "70%" }} />
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a className="news-card" href={item.url} target="_blank" rel="noreferrer">
      {item.imageUrl ? (
        <img className="news-card-img" src={item.imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="news-card-img news-card-img-placeholder" aria-hidden="true">
          🚴
        </div>
      )}
      <div className="news-card-body">
        <span className={`pill news-pill-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
        <h3 className="news-card-title">{item.title}</h3>
        <div className="news-card-date">{formatDate(item.publishedAt)}</div>
        {item.excerpt && <p className="news-card-excerpt">{item.excerpt}</p>}
      </div>
    </a>
  );
}

export function NewsPage() {
  const { items, lastUpdatedAt, loading, error } = useNews();
  const [source, setSource] = useState<NewsSource | "">("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items ?? []).filter((i) => {
      if (source && i.source !== source) return false;
      if (term && !`${i.title} ${i.excerpt ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, source, search]);

  return (
    <div className="wrap-wide">
      <section className="panel">
        <h2>Actualités</h2>
        <p className="hint">
          Agrégées automatiquement chaque jour depuis les sites de l'
          <a href="https://www.paris-brest-paris.org/actualites/" target="_blank" rel="noreferrer">
            organisation PBP
          </a>{" "}
          et de l'
          <a href="https://www.audax-club-parisien.com/actualites/" target="_blank" rel="noreferrer">
            Audax Club Parisien
          </a>
          . Dernière mise à jour : {formatUpdatedAt(lastUpdatedAt)}.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="cal-filters">
          <div className="cal-chips">
            <button type="button" className={`cal-chip${source === "" ? " active" : ""}`} onClick={() => setSource("")}>
              Toutes sources
            </button>
            <button type="button" className={`cal-chip${source === "pbp" ? " active" : ""}`} onClick={() => setSource("pbp")}>
              Paris-Brest-Paris
            </button>
            <button type="button" className={`cal-chip${source === "acp" ? " active" : ""}`} onClick={() => setSource("acp")}>
              Audax Club Parisien
            </button>
          </div>
          <input
            className="cal-search"
            type="search"
            placeholder="Rechercher une actualité…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && (
          <div className="news-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <NewsSkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && <p className="hint">Aucune actualité ne correspond à ces critères.</p>}

        {!loading && filtered.length > 0 && (
          <div className="news-grid">
            {filtered.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
