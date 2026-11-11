import { useRef, useState, type DragEvent } from "react";

// Zone de dépôt GPX : glisser-déposer sur ordinateur, et un vrai bouton de sélection
// de fichier (le glisser-déposer n'existe pas sur téléphone).
export function GpxDropzone({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!/\.gpx$/i.test(file.name)) {
      setError("Ce n'est pas un fichier .gpx.");
      return;
    }
    setError(null);
    onFile(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer.files[0]);
  }

  return (
    <div
      className={`dropzone${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
    >
      <div className="dropzone-icon" aria-hidden="true">
        🗺️
      </div>
      <div className="dropzone-title">{busy ? "Analyse du parcours…" : "Dépose ton fichier GPX ici"}</div>
      <div className="hint" style={{ margin: 0 }}>
        ou touche pour choisir un fichier · trace exportée d'OpenRunner, Komoot, RideWithGPS, Garmin… (25 Mo max)
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        hidden
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
