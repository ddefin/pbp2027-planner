import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/auth";
import { listRoadbooks, uploadRoadbook, type Roadbook } from "../api/roadbooks";
import { GpxDropzone } from "../components/roadbook/GpxDropzone";
import { formatMinutes } from "../lib/roadbook";

const UPLOAD_ERRORS: Record<string, string> = {
  invalid_file_type: "Seuls les fichiers .gpx sont acceptés.",
  unreadable_gpx: "GPX illisible ou sans trace exploitable.",
  file_too_large: "Fichier trop lourd (25 Mo max).",
};

export function RoadbooksPage() {
  const navigate = useNavigate();
  const [roadbooks, setRoadbooks] = useState<Roadbook[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRoadbooks()
      .then(setRoadbooks)
      .catch(() => setError("Impossible de charger tes roadbooks."));
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const rb = await uploadRoadbook(file);
      navigate(`/roadbooks/${rb.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (UPLOAD_ERRORS[err.code] ?? "Import impossible.") : "Import impossible.");
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <section className="panel">
        <h2>Roadbook BRM</h2>
        <p className="hint">
          Importe le GPX de ton brevet : distance, dénivelé, profil, contrôles, heures de passage à ton allure, barrières
          horaires officielles, et suivi en direct le jour J (avec un lien à partager à tes proches).
        </p>
        <GpxDropzone onFile={handleFile} busy={busy} />
        {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
      </section>

      <section className="panel">
        <h2>Mes roadbooks</h2>
        {roadbooks === null && !error && <p className="hint">Chargement…</p>}
        {roadbooks?.length === 0 && <p className="hint">Aucun roadbook pour l'instant.</p>}
        <div className="route-list">
          {roadbooks?.map((r) => (
            <Link key={r.id} to={`/roadbooks/${r.id}`} className="route-item rb-list-item">
              <span>
                <strong>{r.title}</strong>
                <span className="route-stats tabular">
                  {r.distanceKm.toFixed(0)} km · D+ {r.elevationGainM ?? "?"} m · BRM {r.classKm} ({formatMinutes(r.limitMinutes)})
                  {r.startAt && ` · ${new Date(r.startAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`}
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
