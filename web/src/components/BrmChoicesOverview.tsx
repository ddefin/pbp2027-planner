import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBrmCatalog } from "../hooks/useBrmCatalog";
import { useCatalogMeteo } from "../hooks/useCatalogMeteo";
import { useCatalogTrack } from "../hooks/useCatalogTrack";
import { WeatherPanel } from "./WeatherPanel";
import { TrackMap } from "./TrackMap";
import { CATALOG_STATUS_LABEL, daysUntil } from "../lib/brmMeta";

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
          {chosen.map((e) => {
            const remaining = daysUntil(e.date);
            return (
              <div className="brm-card" key={e.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div className="dist">
                    {e.distance} <small>km</small>
                  </div>
                  {remaining >= 0 && (
                    <span className="hint" style={{ margin: 0, fontWeight: 700 }}>
                      {remaining === 0 ? "Aujourd'hui" : `J-${remaining}`}
                    </span>
                  )}
                </div>
                <div className="row">
                  <span>Date</span>
                  <b className="tabular">{e.date.slice(8, 10)}/{e.date.slice(5, 7)}/{e.date.slice(0, 4)}</b>
                </div>
                <div className="row">
                  <span>Lieu</span>
                  <b>{e.ville}</b>
                </div>

                {(e.roadMap || e.siteWeb) && (
                  <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {e.roadMap && (
                      <a href={e.roadMap} target="_blank" rel="noreferrer" className="hint" style={{ margin: 0, textDecoration: "underline" }}>
                        Parcours →
                      </a>
                    )}
                    {e.siteWeb && (
                      <a href={e.siteWeb} target="_blank" rel="noreferrer" className="hint" style={{ margin: 0, textDecoration: "underline" }}>
                        Inscription →
                      </a>
                    )}
                  </div>
                )}

                <MeteoToggle catalogEventId={e.id} />
                <TrackToggle catalogEventId={e.id} />

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {e.participants.map((p, i) => (
                    <span key={i} className="hint" style={{ margin: 0 }}>
                      {p.displayName} · {CATALOG_STATUS_LABEL[p.status as keyof typeof CATALOG_STATUS_LABEL] ?? p.status}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Chargée seulement au clic : éviter un appel météo par BRM affiché à chaque visite
// du tableau de bord (quota limité côté OpenWeatherMap).
function MeteoToggle({ catalogEventId }: { catalogEventId: string }) {
  const [open, setOpen] = useState(false);
  const { weather, status } = useCatalogMeteo(open ? catalogEventId : null);

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="ghost" onClick={() => setOpen((v) => !v)} style={{ padding: "4px 10px", fontSize: 11.5 }}>
        {open ? "Masquer la météo" : "Voir la météo"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <WeatherPanel status={status} weather={weather} />
        </div>
      )}
    </div>
  );
}

// Carte du tracé GPX : chargée au clic, comme la météo. Si personne n'a encore
// partagé de tracé pour ce BRM, affiche un import — partagé avec tout le groupe une
// fois uploadé (voir CatalogTrack côté serveur), pas seulement visible par soi-même.
function TrackToggle({ catalogEventId }: { catalogEventId: string }) {
  const [open, setOpen] = useState(false);
  const { track, loading, error, upload } = useCatalogTrack(open ? catalogEventId : null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await upload(file);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="ghost" onClick={() => setOpen((v) => !v)} style={{ padding: "4px 10px", fontSize: 11.5 }}>
        {open ? "Masquer la carte" : "Voir la carte du parcours"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {loading && <p className="hint" style={{ margin: 0 }}>Chargement…</p>}
          {error && <div className="error-banner">{error}</div>}

          {!loading && track && (
            <>
              <TrackMap points={track.points.map((p) => ({ lat: p.lat, lon: p.lon }))} />
              <p className="hint" style={{ marginTop: 8, marginBottom: 6 }}>
                {track.fileName}
                {track.distanceKm != null && ` · ${track.distanceKm} km`}
                {track.elevationGainM != null && ` · D+ ${track.elevationGainM} m`}
              </p>
              <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ padding: "4px 10px", fontSize: 11.5 }}>
                {busy ? "Import…" : "Remplacer le GPX"}
              </button>
              <input ref={fileInputRef} type="file" accept=".gpx" hidden onChange={handleFileChange} />
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Utile si l'organisateur modifie le tracé — le nouveau fichier remplace celui-ci pour tout le groupe.
              </p>
            </>
          )}

          {!loading && !track && (
            <div>
              <p className="hint" style={{ marginTop: 0 }}>
                Personne n'a encore partagé de tracé GPX pour ce BRM.
              </p>
              <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ padding: "4px 10px", fontSize: 11.5 }}>
                {busy ? "Import…" : "Uploader un fichier GPX"}
              </button>
              <input ref={fileInputRef} type="file" accept=".gpx" hidden onChange={handleFileChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
