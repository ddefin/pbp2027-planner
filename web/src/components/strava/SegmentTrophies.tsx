import { useMemo, useState } from "react";
import { Crown, ExternalLink, Medal, Trophy as TrophyIcon } from "lucide-react";
import type { StravaRecords, Trophy } from "../../api/strava";
import { activityUrl, chrono, frDate, monthLabel, num, segmentUrl } from "./stravaFormat";

type Filter = "ranked" | "kom" | "top10" | "pr"; // ranked = tous les KOM et Top 10
type Sort = "rank" | "date";

function RankBadge({ t }: { t: Trophy }) {
  if (t.kind === "kom")
    return (
      <span className="st-rank is-kom">
        <Crown size={14} aria-hidden="true" /> KOM/QOM
      </span>
    );
  if (t.kind === "top10")
    return (
      <span className="st-rank is-top10">
        <Medal size={14} aria-hidden="true" /> {t.rank}e
      </span>
    );
  return (
    <span className="st-rank is-pr">
      <TrophyIcon size={14} aria-hidden="true" /> PR
    </span>
  );
}

const CAT = ["", "Cat. 4", "Cat. 3", "Cat. 2", "Cat. 1", "HC"];

// « 👑 KOM, Top 10 et PR » : compteurs puis récap complet, filtrable et triable.
export function SegmentTrophies({ data, segments, history }: { data: StravaRecords["trophies"]; segments: StravaRecords["segments"]; history: StravaRecords["history"] }) {
  const [filter, setFilter] = useState<Filter>("ranked");
  const [sort, setSort] = useState<Sort>("rank");
  const list = useMemo(() => {
    const l = data.list.filter((t) => (filter === "ranked" ? t.kind !== "pr" : t.kind === filter));
    return sort === "date" ? [...l].sort((a, b) => b.date.localeCompare(a.date)) : l;
  }, [data.list, filter, sort]);
  const pending = segments.total - segments.analysed;
  const toggle = (f: Filter) => setFilter(filter === f ? "ranked" : f);
  const since = history.done && history.firstRideAt ? ` depuis ${history.firstRideAt.slice(0, 4)}` : "";
  const title = { ranked: `Tous mes KOM/QOM et Top 10${since}`, kom: `Mes KOM/QOM${since}`, top10: `Mes Top 10${since}`, pr: "Mes PR de la saison" }[filter];
  const pct = segments.total > 0 ? Math.round((segments.analysed / segments.total) * 100) : 100;
  const inProgress = !history.done || pending > 0;
  // Regroupement par année quand la liste est triée par date.
  const groups = useMemo(() => {
    if (sort !== "date") return [{ year: null as string | null, items: list }];
    const m = new Map<string, Trophy[]>();
    for (const t of list) m.set(t.date.slice(0, 4), [...(m.get(t.date.slice(0, 4)) ?? []), t]);
    return [...m.entries()].map(([year, items]) => ({ year: year as string | null, items }));
  }, [list, sort]);

  return (
    <div className="st-tro">
      <div className="st-tro-counts">
        <button type="button" className={`st-count is-kom${filter === "kom" ? " is-on" : ""}`} aria-pressed={filter === "kom"} onClick={() => toggle("kom")}>
          <Crown size={20} aria-hidden="true" />
          <strong>{data.kom}</strong>
          <span>KOM / QOM</span>
        </button>
        <button type="button" className={`st-count is-top10${filter === "top10" ? " is-on" : ""}`} aria-pressed={filter === "top10"} onClick={() => toggle("top10")}>
          <Medal size={20} aria-hidden="true" />
          <strong>{data.top10}</strong>
          <span>Top 10</span>
        </button>
        <button type="button" className={`st-count is-pr${filter === "pr" ? " is-on" : ""}`} aria-pressed={filter === "pr"} onClick={() => toggle("pr")}>
          <TrophyIcon size={20} aria-hidden="true" />
          <strong>{data.prSeason}</strong>
          <span>PR cette saison</span>
        </button>
      </div>

      {inProgress && (
        <div className="sv-notice st-pending" role="status">
          <p>
            {!history.done
              ? `Lecture de ton historique Strava en cours (jusqu'à ${history.oldestLoaded ? monthLabel(history.oldestLoaded.slice(0, 7)).toLowerCase() : "…"} pour l'instant).`
              : "Historique lu en entier."}{" "}
            Analyse des segments : <strong>{pct} %</strong> ({segments.analysed} / {segments.total} sorties à trophées).
          </p>
          <div className="st-gauge" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Analyse des segments">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="st-pending-note">Strava limite le nombre de lectures : la suite arrive toute seule, à petit débit (quelques jours au plus pour un long historique).</p>
        </div>
      )}

      {data.list.length === 0 ? (
        <p className="hint">{segments.total === 0 ? "Aucune sortie avec des trophées Strava (PR, KOM, Top 10) sur les 13 derniers mois." : "Aucun KOM, Top 10 ou PR trouvé pour l'instant."}</p>
      ) : (
        <>
          <div className="st-tro-bar">
            <span className="st-tro-n" aria-live="polite">
              <strong>{title}</strong> · {list.length} segment{list.length > 1 ? "s" : ""}
              {filter !== "ranked" && (
                <>
                  {" · "}
                  <button type="button" className="gb-linkbtn" onClick={() => setFilter("ranked")}>
                    tous les KOM et Top 10
                  </button>
                </>
              )}
            </span>
            <label className="st-sort">
              Trier par
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="rank">Rang</option>
                <option value="date">Date</option>
              </select>
            </label>
          </div>
          {list.length === 0 && <p className="hint">Rien dans cette catégorie pour l'instant.</p>}
          {groups.map((g) => (
          <div key={g.year ?? "all"} className="st-tro-group">
          {g.year && (
            <h4 className="st-tro-year">
              {g.year} <span>{g.items.length}</span>
            </h4>
          )}
          <ul className="st-tro-list">
            {g.items.map((t) => (
              <li key={`${t.kind}-${t.segmentId}`} className={`st-tro-row is-${t.kind}`}>
                <RankBadge t={t} />
                <div className="st-tro-seg">
                  <a href={segmentUrl(t.segmentId)} target="_blank" rel="noopener noreferrer">
                    {t.segmentName} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <span>
                    {num(t.km, 1)} km
                    {t.gradePct !== null ? ` · ${num(t.gradePct, 1)} %` : ""}
                    {t.climbCategory ? ` · ${CAT[t.climbCategory] ?? ""}` : ""}
                    {t.city ? ` · ${t.city}` : ""}
                  </span>
                </div>
                <span className="st-tro-time tabular">{chrono(t.elapsedSec)}</span>
                <a className="st-tro-date" href={activityUrl(t.activityId)} target="_blank" rel="noopener noreferrer">
                  {frDate(t.date)}
                </a>
              </li>
            ))}
          </ul>
          </div>
          ))}
          <p className="hint">
            KOM/QOM et Top 10 : ton rang au classement du segment au moment de la sortie (il a pu changer depuis). PR : ton meilleur temps personnel. Seuls tes propres efforts sont
            affichés.
          </p>
        </>
      )}
    </div>
  );
}
