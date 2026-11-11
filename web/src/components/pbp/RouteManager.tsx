import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/auth";
import { pbpRouteGpxUrl, type PbpRouteMeta, type RouteKind } from "../../api/pbpRoutes";
import { KIND_LABEL } from "../../lib/pbpMeta";

const UPLOAD_ERRORS: Record<string, string> = {
  invalid_file_type: "Seuls les fichiers .gpx sont acceptés.",
  unreadable_gpx: "GPX illisible ou sans trace (aucun <trkpt>/<rtept> exploitable).",
  file_too_large: "Fichier trop lourd (25 Mo max).",
};

// Liste des tracés disponibles : choix du tracé principal (radio), superposition
// pour comparaison (cases), import d'un GPX, et pour l'admin le changement de statut
// (c'est ce qui fait basculer tout le monde sur le tracé officiel le jour venu).
export function RouteManager({
  routes,
  primaryId,
  compareIds,
  isAdmin,
  onSelectPrimary,
  onToggleCompare,
  onUpload,
  onChangeKind,
  onDelete,
}: {
  routes: PbpRouteMeta[];
  primaryId: string | null;
  compareIds: Set<string>;
  isAdmin: boolean;
  onSelectPrimary: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onUpload: (input: { file: File; label: string; kind: RouteKind }) => Promise<void>;
  onChangeKind: (id: string, kind: RouteKind) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RouteKind>(isAdmin ? "provisoire" : "communautaire");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onUpload({ file, label: label.trim() || file.name.replace(/\.gpx$/i, ""), kind });
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof ApiError ? (UPLOAD_ERRORS[err.code] ?? "Import impossible.") : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="route-list">
        {routes.map((r) => (
          <div key={r.id} className={`route-item${r.id === primaryId ? " is-primary" : ""}`}>
            <label className="route-pick">
              <input type="radio" name="primary-route" checked={r.id === primaryId} onChange={() => onSelectPrimary(r.id)} />
              <span>
                <span className={`kind-badge kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span> <strong>{r.label}</strong>
                <span className="route-stats tabular">
                  {Math.round(r.distanceKm)} km
                  {r.elevationGainM !== null && ` · D+ ${r.elevationGainM.toLocaleString("fr-FR")} m`}
                  {r.uploadedBy && ` · par ${r.uploadedBy}`}
                </span>
              </span>
            </label>
            <div className="route-actions">
              {r.id !== primaryId && (
                <label className="route-compare">
                  <input type="checkbox" checked={compareIds.has(r.id)} onChange={() => onToggleCompare(r.id)} /> comparer
                </label>
              )}
              {r.kind !== "indicatif" && (
                <a className="ghost-link" href={pbpRouteGpxUrl(r.id)} download>
                  GPX
                </a>
              )}
              {isAdmin && r.kind !== "indicatif" && (
                <select value={r.kind} onChange={(e) => onChangeKind(r.id, e.target.value as RouteKind)} aria-label="Statut du tracé">
                  <option value="officiel">Officiel</option>
                  <option value="provisoire">Provisoire</option>
                  <option value="communautaire">Communautaire</option>
                </select>
              )}
              {r.canDelete && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => confirm(`Supprimer le tracé « ${r.label} » ?`) && onDelete(r.id)}
                >
                  Supprimer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="route-upload" onSubmit={handleSubmit}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="route-label">Importer un tracé GPX</label>
          <input id="route-label" placeholder="Nom (ex. Variante retour par Dreux)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml" required />
          {isAdmin && (
            <select value={kind} onChange={(e) => setKind(e.target.value as RouteKind)} aria-label="Statut">
              <option value="officiel">Officiel</option>
              <option value="provisoire">Provisoire</option>
              <option value="communautaire">Communautaire</option>
            </select>
          )}
          <button className="primary" type="submit" disabled={busy} style={{ width: "auto", padding: "8px 18px" }}>
            {busy ? "Analyse…" : "Importer"}
          </button>
        </div>
        {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}
        <p className="hint" style={{ marginBottom: 0 }}>
          {isAdmin
            ? "Un tracé « Officiel » devient automatiquement le tracé affiché par défaut pour tout le monde."
            : "Ton tracé est partagé comme « communautaire » : visible et comparable par tous, sans remplacer le tracé de référence."}
        </p>
      </form>
    </>
  );
}
