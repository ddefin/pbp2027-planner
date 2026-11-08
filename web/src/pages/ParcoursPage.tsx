import { useRef, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useParcours } from "../hooks/useParcours";
import { useBrmEvents } from "../hooks/useBrmEvents";
import { useMeteo } from "../hooks/useMeteo";
import { WeatherPanel } from "../components/WeatherPanel";
import { parcoursFileDownloadUrl } from "../api/parcours";
import { formatMinutes } from "../lib/brmMeta";

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
            <LiveMeteoSection brmEventId={id} />
            <NotesSection parcours={parcours ?? null} onSave={save} />
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

function LiveMeteoSection({ brmEventId }: { brmEventId: string }) {
  const { weather, status } = useMeteo(brmEventId);
  return <WeatherPanel status={status} weather={weather} />;
}

function NotesSection({
  parcours,
  onSave,
}: {
  parcours: ReturnType<typeof useParcours>["parcours"];
  onSave: ReturnType<typeof useParcours>["save"];
}) {
  const [notes, setNotes] = useState(parcours?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await onSave({ notes: notes || null });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ background: "var(--bg)" }}>
      <div className="t" style={{ fontWeight: 700, marginBottom: 10 }}>Notes pour l'ultra-distance</div>
      <p className="hint">Ravitos, points de vigilance, sécurité — tout ce que la météo ou les stats ne disent pas.</p>

      <div className="field">
        <textarea
          aria-label="Notes"
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
