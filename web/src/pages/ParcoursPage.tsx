import { useRef, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useParcours } from "../hooks/useParcours";
import { useBrmEvents } from "../hooks/useBrmEvents";
import { parcoursFileDownloadUrl } from "../api/parcours";
import { formatMinutes } from "../lib/brmMeta";

const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

export function ParcoursPage() {
  const { brmEventId } = useParams<{ brmEventId: string }>();
  const id = brmEventId ?? "";
  const { parcours, loading, error, save, uploadFile, removeFile } = useParcours(id);
  const brm = useBrmEvents();
  const event = brm.events?.find((e) => e.id === id);

  return (
    <div className="wrap-wide">
      <div style={{ marginBottom: 16 }}>
        <Link to="/" className="hint" style={{ textDecoration: "underline" }}>
          ← Retour au tableau de bord
        </Link>
      </div>

      <section className="panel">
        <h2>
          Parcours {event ? `— BRM ${event.distance} km, ${event.lieu}` : ""}
        </h2>
        {event && (
          <p className="hint">
            {event.date.slice(0, 10)} · limite {formatMinutes(event.limiteMinutes)}
          </p>
        )}
        {error && <div className="error-banner">{error}</div>}
        {loading && <p className="hint">Chargement…</p>}

        {!loading && (
          <>
            <SourceSection parcours={parcours ?? null} onSave={save} onUpload={uploadFile} onRemoveFile={removeFile} brmEventId={id} />
            <StatsSection parcours={parcours ?? null} />
            <WeatherSection parcours={parcours ?? null} onSave={save} />
          </>
        )}
      </section>
    </div>
  );
}

function SourceSection({
  parcours,
  onSave,
  onUpload,
  onRemoveFile,
  brmEventId,
}: {
  parcours: ReturnType<typeof useParcours>["parcours"];
  onSave: ReturnType<typeof useParcours>["save"];
  onUpload: ReturnType<typeof useParcours>["uploadFile"];
  onRemoveFile: ReturnType<typeof useParcours>["removeFile"];
  brmEventId: string;
}) {
  const [url, setUrl] = useState(parcours?.sourceUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFetch(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const autoFetched = await onSave({ sourceUrl: url.trim() });
      setMessage(
        autoFetched
          ? "Récupéré automatiquement depuis OpenRunner."
          : "Lien enregistré, mais la récupération automatique a échoué — uploade le fichier GPX ci-dessous.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const statsParsed = await onUpload(file);
      setMessage(statsParsed ? "Fichier importé, statistiques calculées." : "Fichier importé, mais ses statistiques n'ont pas pu être calculées.");
    } catch {
      setMessage("Échec de l'import — vérifie que c'est bien un fichier .gpx.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!confirm("Supprimer le fichier GPX de ce parcours ?")) return;
    setBusy(true);
    try {
      await onRemoveFile();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ background: "var(--bg)" }}>
      <div className="t" style={{ fontWeight: 700, marginBottom: 10 }}>Tracé du parcours</div>

      <form onSubmit={handleFetch} style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          type="url"
          placeholder="https://www.openrunner.com/route-details/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px", color: "var(--fg)", fontFamily: "inherit", fontSize: 13.5 }}
        />
        <button className="ghost" type="submit" disabled={busy}>
          Récupérer automatiquement
        </button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          {parcours?.hasFile ? "Remplacer le fichier GPX" : "Uploader un fichier GPX"}
        </button>
        <input ref={fileInputRef} type="file" accept=".gpx" hidden onChange={handleFileChange} />
        {parcours?.hasFile && (
          <>
            <a href={parcoursFileDownloadUrl(brmEventId)} className="hint" style={{ textDecoration: "underline" }}>
              {parcours.fileName}
            </a>
            <button type="button" className="ghost" onClick={handleRemove} disabled={busy}>
              Retirer
            </button>
          </>
        )}
      </div>

      {message && <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>{message}</p>}
      <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
        Si l'automatique échoue (lien privé, parcours sans profil altimétrique…), uploade directement l'export GPX du
        parcours — depuis OpenRunner, Komoot, Garmin Connect, etc.
      </p>
    </div>
  );
}

function StatsSection({ parcours }: { parcours: ReturnType<typeof useParcours>["parcours"] }) {
  if (!parcours || (parcours.distanceKm == null && parcours.elevationGainM == null)) {
    return (
      <div className="panel" style={{ background: "var(--bg)" }}>
        <p className="hint" style={{ margin: 0 }}>Aucune statistique pour l'instant — récupère ou uploade un parcours ci-dessus.</p>
      </div>
    );
  }

  const stats: { label: string; value: string }[] = [
    { label: "Distance", value: parcours.distanceKm != null ? `${parcours.distanceKm} km` : "—" },
    { label: "D+", value: parcours.elevationGainM != null ? `${parcours.elevationGainM} m` : "—" },
    { label: "D-", value: parcours.elevationLossM != null ? `${parcours.elevationLossM} m` : "—" },
    {
      label: "Altitude",
      value: parcours.minAltitudeM != null && parcours.maxAltitudeM != null ? `${parcours.minAltitudeM} – ${parcours.maxAltitudeM} m` : "—",
    },
  ];

  return (
    <div className="brm-grid" style={{ marginBottom: 20 }}>
      {stats.map((s) => (
        <div className="brm-card" key={s.label}>
          <div className="row" style={{ marginTop: 0 }}>
            <span>{s.label}</span>
          </div>
          <div className="dist" style={{ fontSize: 24 }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function WeatherSection({
  parcours,
  onSave,
}: {
  parcours: ReturnType<typeof useParcours>["parcours"];
  onSave: ReturnType<typeof useParcours>["save"];
}) {
  const [windDirection, setWindDirection] = useState(parcours?.windDirection ?? "");
  const [windSpeedKmh, setWindSpeedKmh] = useState(parcours?.windSpeedKmh?.toString() ?? "");
  const [windGustsKmh, setWindGustsKmh] = useState(parcours?.windGustsKmh?.toString() ?? "");
  const [tempMinC, setTempMinC] = useState(parcours?.tempMinC?.toString() ?? "");
  const [tempMaxC, setTempMaxC] = useState(parcours?.tempMaxC?.toString() ?? "");
  const [precipitation, setPrecipitation] = useState(parcours?.precipitation ?? "");
  const [notes, setNotes] = useState(parcours?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toIntOrNull(v: string): number | null {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? Math.round(n) : null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await onSave({
        windDirection: windDirection || null,
        windSpeedKmh: toIntOrNull(windSpeedKmh),
        windGustsKmh: toIntOrNull(windGustsKmh),
        tempMinC: toIntOrNull(tempMinC),
        tempMaxC: toIntOrNull(tempMaxC),
        precipitation: precipitation || null,
        notes: notes || null,
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ background: "var(--bg)" }}>
      <div className="t" style={{ fontWeight: 700, marginBottom: 10 }}>Météo prévue et notes pour l'ultra-distance</div>
      <p className="hint">
        À remplir à mesure que la date approche — pas encore de prévision automatique.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="wind-dir">Direction du vent</label>
          <select
            id="wind-dir"
            value={windDirection}
            onChange={(e) => setWindDirection(e.target.value)}
            style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", color: "var(--fg)", fontFamily: "inherit" }}
          >
            <option value="">—</option>
            {WIND_DIRECTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="wind-speed">Vent (km/h)</label>
          <input id="wind-speed" type="number" min={0} max={300} value={windSpeedKmh} onChange={(e) => setWindSpeedKmh(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="wind-gusts">Rafales (km/h)</label>
          <input id="wind-gusts" type="number" min={0} max={300} value={windGustsKmh} onChange={(e) => setWindGustsKmh(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="temp-min">Temp. min (°C)</label>
          <input id="temp-min" type="number" min={-60} max={60} value={tempMinC} onChange={(e) => setTempMinC(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="temp-max">Temp. max (°C)</label>
          <input id="temp-max" type="number" min={-60} max={60} value={tempMaxC} onChange={(e) => setTempMaxC(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="precipitation">Précipitations</label>
        <input id="precipitation" value={precipitation} onChange={(e) => setPrecipitation(e.target.value)} placeholder="averses possibles en fin de nuit, sec, etc." />
      </div>

      <div className="field">
        <label htmlFor="notes">Notes (ravitos, points de vigilance, sécurité…)</label>
        <textarea
          id="notes"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", color: "var(--fg)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
        />
      </div>

      <button className="primary" type="submit" disabled={busy} style={{ width: "auto", padding: "10px 20px" }}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
      {saved && !busy && <span className="hint" style={{ marginLeft: 12 }}>Enregistré.</span>}
    </form>
  );
}
