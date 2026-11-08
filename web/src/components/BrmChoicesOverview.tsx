import { Link } from "react-router-dom";
import { useBrmCatalog } from "../hooks/useBrmCatalog";
import { CATALOG_STATUS_LABEL } from "../lib/brmMeta";

// Vue collective des BRM choisis par les randonneurs sur le calendrier (plutôt
// qu'une saisie manuelle individuelle) : qui part sur quel brevet, visible par
// tout le groupe directement depuis le tableau de bord.
export function BrmChoicesOverview() {
  const { events, loading, error } = useBrmCatalog();
  const chosen = (events ?? []).filter((e) => e.participants.length > 0).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>BRM choisis par le groupe</h2>
        <Link to="/calendrier" className="hint" style={{ textDecoration: "underline" }}>
          Voir le calendrier →
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="hint">Chargement…</p>}
      {!loading && !error && chosen.length === 0 && (
        <p className="hint">
          Personne n'a encore choisi de BRM — rendez-vous sur le <Link to="/calendrier">calendrier</Link> pour s'inscrire.
        </p>
      )}

      {!loading && chosen.length > 0 && (
        <div className="brm-grid">
          {chosen.map((e) => (
            <div className="brm-card" key={e.id}>
              <div className="dist">
                {e.distance} <small>km</small>
              </div>
              <div className="row">
                <span>Date</span>
                <b className="tabular">{e.date.slice(8, 10)}/{e.date.slice(5, 7)}/{e.date.slice(0, 4)}</b>
              </div>
              <div className="row">
                <span>Lieu</span>
                <b>{e.ville}</b>
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {e.participants.map((p, i) => (
                  <span key={i} className="hint" style={{ margin: 0 }}>
                    {p.displayName} · {CATALOG_STATUS_LABEL[p.status as keyof typeof CATALOG_STATUS_LABEL] ?? p.status}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
