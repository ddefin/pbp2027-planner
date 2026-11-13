import { useRef, useState } from "react";
import { useCatalogMeteo } from "../../hooks/useCatalogMeteo";
import { useCatalogTrack } from "../../hooks/useCatalogTrack";
import { useControlPoints } from "../../hooks/useControlPoints";
import { useTrackVariants } from "../../hooks/useTrackVariants";
import { WeatherPanel } from "../WeatherPanel";
import { TrackMap } from "../TrackMap";
import { ElevationProfile } from "../ElevationProfile";
import { compassToDeg, overallBearing, windRelation, WIND_RELATION_LABEL } from "../../lib/gpxAnalysis";
import { buildEnrichedGpx, downloadGpx } from "../../lib/gpxExport";
import type { ControlPointKind, TrackPoint } from "../../api/brmCatalog";

// Météo et carte d'un BRM du calendrier, déplacées telles quelles depuis l'ancienne
// section « BRM choisis par le groupe » (logique inchangée : chargement au clic).

const CONTROL_POINT_KIND_LABEL: Record<ControlPointKind, string> = {
  depart: "🏁 Départ",
  arrivee: "🏁 Arrivée",
  ravito: "🍊 Ravito",
  controle: "📍 Contrôle",
};

const VARIANT_LEGEND_COLORS = ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ec4899", "#14b8a6"];

// Chargée seulement au clic : éviter un appel météo par BRM affiché à chaque visite
// du tableau de bord (quota limité côté OpenWeatherMap).
export function MeteoToggle({ catalogEventId }: { catalogEventId: string }) {
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
export function TrackToggle({ catalogEventId }: { catalogEventId: string }) {
  const [open, setOpen] = useState(false);
  const { track, loading, error, upload } = useCatalogTrack(open ? catalogEventId : null);
  // Météo déjà mise en cache côté serveur par ville (15 min, voir openWeather.ts) :
  // ce second appel indépendant du bouton météo n'ajoute pas de coût réel.
  const { weather } = useCatalogMeteo(open ? catalogEventId : null);
  const { points: controlPoints, add: addControlPoint, remove: removeControlPoint } = useControlPoints(open ? catalogEventId : null);
  const { variants, error: variantError, upload: uploadVariant, remove: removeVariant } = useTrackVariants(open ? catalogEventId : null);
  const [busy, setBusy] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<TrackPoint | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const variantInputRef = useRef<HTMLInputElement>(null);

  const [addingPoint, setAddingPoint] = useState(false);
  const [newKind, setNewKind] = useState<ControlPointKind>("ravito");
  const [newLabel, setNewLabel] = useState("");
  const [pendingVariantLabel, setPendingVariantLabel] = useState("");

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

  async function handleMapClick(lat: number, lon: number) {
    if (!addingPoint || !newLabel.trim()) return;
    await addControlPoint({ kind: newKind, label: newLabel.trim(), lat, lon });
    setAddingPoint(false);
    setNewLabel("");
  }

  async function handleVariantFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadVariant(file, pendingVariantLabel.trim() || file.name);
    setPendingVariantLabel("");
    if (variantInputRef.current) variantInputRef.current.value = "";
  }

  function handleExportGpx() {
    if (!track) return;
    const xml = buildEnrichedGpx({ name: track.fileName.replace(/\.gpx$/i, ""), points: track.points, controlPoints });
    downloadGpx(`${track.fileName.replace(/\.gpx$/i, "")}-enrichi.gpx`, xml);
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
              <TrackMap
                points={track.points}
                highlight={hoverPoint}
                controlPoints={controlPoints}
                onDeleteControlPoint={removeControlPoint}
                addControlPointMode={addingPoint}
                onMapClick={handleMapClick}
                variants={variants}
              />
              <p className="hint" style={{ marginTop: 8, marginBottom: 6 }}>
                {track.fileName}
                {track.distanceKm != null && ` · ${track.distanceKm} km`}
                {track.elevationGainM != null && ` · D+ ${track.elevationGainM} m`}
              </p>

              <WindHint points={track.points} windDirection={weather?.current.windDirection} windSpeedKmh={weather?.current.windSpeedKmh} />

              <ElevationProfile points={track.points} onHoverPoint={setHoverPoint} />

              {/* Points de ravito/contrôle */}
              <div style={{ marginTop: 12 }}>
                <p className="hint" style={{ margin: 0, fontWeight: 700 }}>Points de ravito/contrôle</p>
                {controlPoints.length === 0 && <p className="hint" style={{ margin: "4px 0" }}>Aucun point ajouté pour l'instant.</p>}
                {controlPoints.map((cp) => (
                  <div key={cp.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, margin: "3px 0" }}>
                    <span>{CONTROL_POINT_KIND_LABEL[cp.kind]} — {cp.label}</span>
                    {cp.mine && (
                      <button type="button" className="ghost msg-delete" onClick={() => removeControlPoint(cp.id)} style={{ padding: "1px 6px", fontSize: 11 }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}

                {!addingPoint ? (
                  <button type="button" className="ghost" onClick={() => setAddingPoint(true)} style={{ padding: "4px 10px", fontSize: 11.5, marginTop: 6 }}>
                    + Ajouter un point
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                    <select value={newKind} onChange={(e) => setNewKind(e.target.value as ControlPointKind)} style={{ fontSize: 12 }}>
                      {Object.entries(CONTROL_POINT_KIND_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Libellé (ex. Boulangerie)"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      style={{ fontSize: 12, minWidth: 160 }}
                    />
                    <span className="hint" style={{ margin: 0 }}>Puis clique sur la carte.</span>
                    <button type="button" className="ghost" onClick={() => setAddingPoint(false)} style={{ padding: "1px 8px", fontSize: 11 }}>
                      Annuler
                    </button>
                  </div>
                )}
              </div>

              {/* Variantes de tracé (comparateur) */}
              <div style={{ marginTop: 12 }}>
                <p className="hint" style={{ margin: 0, fontWeight: 700 }}>Variantes à comparer</p>
                {variantError && <div className="error-banner">{variantError}</div>}
                {variants.map((v, i) => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, margin: "3px 0" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: VARIANT_LEGEND_COLORS[i % VARIANT_LEGEND_COLORS.length] }} />
                    <span>
                      {v.label}
                      {v.distanceKm != null && ` · ${v.distanceKm} km`}
                      {v.elevationGainM != null && ` · D+ ${v.elevationGainM} m`}
                      {" "}· par {v.uploadedBy}
                    </span>
                    {v.mine && (
                      <button type="button" className="ghost msg-delete" onClick={() => removeVariant(v.id)} style={{ padding: "1px 6px", fontSize: 11 }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Libellé de la variante (ex. Évite Nogent)"
                    value={pendingVariantLabel}
                    onChange={(e) => setPendingVariantLabel(e.target.value)}
                    style={{ fontSize: 12, minWidth: 180 }}
                  />
                  <button type="button" className="ghost" onClick={() => variantInputRef.current?.click()} style={{ padding: "4px 10px", fontSize: 11.5 }}>
                    + Comparer un GPX
                  </button>
                  <input ref={variantInputRef} type="file" accept=".gpx" hidden onChange={handleVariantFileChange} />
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ padding: "4px 10px", fontSize: 11.5 }}>
                  {busy ? "Import…" : "Remplacer le GPX"}
                </button>
                <button type="button" className="ghost" onClick={handleExportGpx} style={{ padding: "4px 10px", fontSize: 11.5 }}>
                  Exporter en GPX (avec les points)
                </button>
                <input ref={fileInputRef} type="file" accept=".gpx" hidden onChange={handleFileChange} />
              </div>
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Remplacer le GPX est utile si l'organisateur modifie le tracé — le nouveau fichier remplace celui-ci pour tout le groupe.
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

// Vent actuel (météo déjà récupérée pour ce BRM) comparé au cap général du parcours
// (départ → arrivée). Une approximation assumée : un BRM repart souvent du même
// point qu'il y arrive, donc ce n'est pas le vent sur chaque portion du trajet, pas
// plus que le vent prévu le jour J — juste un repère utile, pas une prévision de
// route précise par segment.
function WindHint({
  points,
  windDirection,
  windSpeedKmh,
}: {
  points: TrackPoint[];
  windDirection: string | undefined;
  windSpeedKmh: number | undefined;
}) {
  if (!windDirection || windSpeedKmh === undefined) return null;
  const windDeg = compassToDeg(windDirection);
  const routeBearing = overallBearing(points);
  if (windDeg === null || routeBearing === null) return null;

  const relation = windRelation(windDeg, routeBearing);

  return (
    <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
      Vent actuel {windDirection} {windSpeedKmh} km/h · {WIND_RELATION_LABEL[relation]} sur le cap général du parcours
    </p>
  );
}
