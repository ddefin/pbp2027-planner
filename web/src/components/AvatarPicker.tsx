import { useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import type { AvatarData } from "../api/auth";
import { ApiError } from "../api/auth";
import { clearAvatar, setPresetAvatar, uploadAvatarPhoto } from "../api/profile";
import { useAuth } from "../context/AuthContext";
import { Avatar, AVATAR_COLORS, AVATAR_ICONS } from "./Avatar";

const SIZE = 256;

// Recadre la photo en carré centré et la réduit à 256 px dans le navigateur : l'envoi est
// léger, et l'image redessinée ne contient plus les données de l'appareil (position GPS…).
async function squarePhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
    const blob = (await toBlob("image/webp")) ?? (await toBlob("image/jpeg"));
    // Certains navigateurs ignorent le type demandé et rendent du PNG : accepté aussi par le serveur.
    if (!blob) throw new Error("image");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const ERRORS: Record<string, string> = {
  unsupported_image: "Ce fichier n'est pas une image JPEG, PNG ou WebP.",
  file_too_large: "Image trop lourde.",
  too_many_requests: "Trop de changements d'avatar : réessaie dans une heure.",
};

export function AvatarPicker() {
  const { user, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const current = user?.avatar ?? null;
  const preset = current?.kind === "preset" ? current : null;
  const [icon, setIcon] = useState(preset?.icon ?? "bike");
  const [color, setColor] = useState(preset?.color ?? "coral");
  const name = user?.prenom ?? "?";

  async function run(action: () => Promise<AvatarData>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await refresh(); // la barre du haut et le reste du site prennent le nouvel avatar
      setMessage({ ok: true, text: done });
    } catch (err) {
      setMessage({ ok: false, text: (err instanceof ApiError && ERRORS[err.code]) || "Impossible d'enregistrer l'avatar pour le moment." });
    } finally {
      setBusy(false);
    }
  }

  const choose = (nextIcon: string, nextColor: string) => {
    setIcon(nextIcon);
    setColor(nextColor);
    void run(() => setPresetAvatar(nextIcon, nextColor), "Avatar enregistré.");
  };

  return (
    <div className="avp">
      <div className="avp-current">
        <Avatar name={name} avatar={current} size={72} />
        <div>
          <strong>{current?.kind === "photo" ? "Ta photo" : current?.kind === "preset" ? "Avatar illustré" : "Tes initiales"}</strong>
          <p className="hint" style={{ margin: "2px 0 0" }}>Visible des membres connectés : messagerie, BRM du groupe, carte du groupe.</p>
        </div>
      </div>

      <fieldset className="avp-group" disabled={busy}>
        <legend>Une icône</legend>
        <div className="avp-icons" role="radiogroup" aria-label="Icône de l'avatar">
          {Object.entries(AVATAR_ICONS).map(([id, { icon: Icon, label }]) => (
            <button key={id} type="button" role="radio" aria-checked={preset?.icon === id} aria-label={label} title={label} className={`avp-icon${preset?.icon === id ? " is-on" : ""}`} onClick={() => choose(id, color)}>
              <Icon size={22} aria-hidden="true" />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="avp-group" disabled={busy}>
        <legend>Sa couleur</legend>
        <div className="avp-colors" role="radiogroup" aria-label="Couleur de l'avatar">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={preset?.color === c} aria-label={c} className={`avp-color av-${c}${preset?.color === c ? " is-on" : ""}`} onClick={() => choose(icon, c)} />
          ))}
        </div>
      </fieldset>

      <div className="avp-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Camera size={16} aria-hidden="true" /> {current?.kind === "photo" ? "Changer de photo" : "Utiliser une photo"}
        </button>
        {current && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void run(clearAvatar, "Retour aux initiales.")}>
            <RotateCcw size={16} aria-hidden="true" /> Revenir aux initiales
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(async () => uploadAvatarPhoto(await squarePhoto(f)), "Photo enregistrée.");
          }}
        />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        La photo est recadrée en carré et réduite sur ton appareil avant l'envoi ; sa position GPS et les données de l'appareil ne sont pas transmises.
      </p>
      {message && (
        <p role="status" className={message.ok ? "avp-ok" : "avp-err"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
