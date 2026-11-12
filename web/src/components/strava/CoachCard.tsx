import type { Dashboard } from "../../api/strava";

const ICON = { ok: "✅", attention: "⚠️", alerte: "🚨", info: "ℹ️" } as const;

export function CoachCard({ coach }: { coach: Dashboard["coach"] }) {
  const items = [...coach.diagnostics, ...(coach.balance ? [coach.balance] : [])];
  return (
    <section className="panel sv-coach" aria-labelledby="sv-coach-title">
      <h3 id="sv-coach-title" className="sv-h">
        🧠 Analyse &amp; conseils du Coach
      </h3>
      <p className={`sv-headline sv-lvl-${coach.headline.level}`}>
        {ICON[coach.headline.level]} {coach.headline.text}
      </p>
      <ul className="sv-insights">
        {items.map((i) => (
          <li key={i.title} className={`sv-insight sv-border-${i.level}`}>
            <strong>
              {ICON[i.level]} {i.title}
            </strong>
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      {coach.metrics.length > 0 && (
        <details className="sv-more">
          <summary>Tes métriques prioritaires</summary>
          <ul className="sv-insights">
            {coach.metrics.map((m) => (
              <li key={m.title} className="sv-insight sv-border-info">
                <strong>{m.title}</strong>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <h4 className="sv-h2">Pour les prochains jours</h4>
      <ol className="sv-advice">
        {coach.advice.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>
      <p className="hint" style={{ marginBottom: 0 }}>
        Analyse automatique d'après tes sorties Strava (charge estimée, zones déduites des moyennes de chaque sortie) : une tendance, pas un avis médical.
      </p>
    </section>
  );
}
