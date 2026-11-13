import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "./Dialog";
import { useToast } from "./Toaster";
import { deleteUser, errorText, setRole, suspendUser, unsuspendUser } from "../api";
import { reasonSchema } from "../../../../src/shared/adminSchemas";

export interface ActionTarget {
  id: string;
  prenom: string;
  email: string;
  isAdmin: boolean;
}

type Kind = "suspend" | "unsuspend" | "promote" | "demote" | "delete";

// Boîtes de dialogue des actions sur un compte. Les règles (pas soi-même, dernier admin,
// mot de passe…) sont TOUTES vérifiées par le serveur ; l'interface ne fait que guider.
export function useUserActions(onDone: (kind: Kind, target: ActionTarget) => void) {
  const toast = useToast();
  const [state, setState] = useState<{ kind: Kind; target: ActionTarget } | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(kind: Kind, target: ActionTarget) {
    setState({ kind, target });
    setReason("");
    setPassword("");
    setConfirmEmail("");
    setError(null);
  }
  const close = () => !busy && setState(null);

  async function submit() {
    if (!state) return;
    const { kind, target } = state;
    setError(null);
    if (kind === "suspend") {
      const v = reasonSchema.safeParse({ reason });
      if (!v.success) return setError(v.error.issues[0]?.message ?? "Motif invalide");
    }
    setBusy(true);
    try {
      if (kind === "suspend") await suspendUser(target.id, reason.trim());
      else if (kind === "unsuspend") await unsuspendUser(target.id);
      else if (kind === "promote" || kind === "demote") await setRole(target.id, kind === "promote", password);
      else await deleteUser(target.id, confirmEmail, password);
      const done = { suspend: "suspendu", unsuspend: "réactivé", promote: "nommé administrateur", demote: "n'est plus administrateur", delete: "supprimé (contributions anonymisées)" }[kind];
      toast("success", `${target.prenom} : ${done}.`);
      setState(null);
      onDone(kind, target);
    } catch (err) {
      setError(errorText(err));
      toast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const t = state?.target;
  const kind = state?.kind;
  const titles: Record<Kind, string> = {
    suspend: `Suspendre ${t?.prenom ?? ""}`,
    unsuspend: `Réactiver ${t?.prenom ?? ""}`,
    promote: `Nommer ${t?.prenom ?? ""} administrateur`,
    demote: `Retirer le rôle administrateur à ${t?.prenom ?? ""}`,
    delete: `Supprimer définitivement ${t?.prenom ?? ""}`,
  };
  const canSubmit =
    !busy &&
    (kind === "suspend" ? reason.trim().length >= 3 : kind === "delete" ? confirmEmail.trim().toLowerCase() === t?.email.toLowerCase() && password.length > 0 : kind === "promote" || kind === "demote" ? password.length > 0 : true);

  const dialog = (
    <Dialog
      open={Boolean(state)}
      title={kind ? titles[kind] : ""}
      tone={kind === "delete" || kind === "suspend" ? "danger" : "default"}
      onClose={close}
      onSubmit={() => canSubmit && void submit()}
      footer={
        <>
          <button type="button" className="ad-btn" onClick={close} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className={`ad-btn ${kind === "delete" || kind === "suspend" ? "is-danger" : "is-primary"}`} disabled={!canSubmit}>
            {busy ? "Patiente…" : kind === "delete" ? "Supprimer définitivement" : kind === "suspend" ? "Suspendre" : "Confirmer"}
          </button>
        </>
      }
    >
      {kind === "suspend" && (
        <>
          <p>La connexion de {t?.prenom} sera refusée et ses sessions ouvertes coupées immédiatement. Réversible à tout moment.</p>
          <label className="ad-field">
            <span>Motif (visible dans le journal)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} required autoFocus placeholder="ex. compte partagé, demande de l'intéressé…" />
          </label>
        </>
      )}
      {kind === "unsuspend" && <p>{t?.prenom} pourra de nouveau se connecter. Le verrouillage éventuel après erreurs de mot de passe est aussi levé.</p>}
      {(kind === "promote" || kind === "demote") && (
        <>
          <p>{kind === "promote" ? `${t?.prenom} aura accès à tout l'espace d'administration.` : `${t?.prenom} perdra l'accès à l'administration ; ses sessions seront coupées.`}</p>
          <label className="ad-field">
            <span>Ton mot de passe (confirmation)</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </label>
        </>
      )}
      {kind === "delete" && (
        <>
          <div className="ad-callout is-danger">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>Action irréversible.</strong> Profil, licence, roadbooks, BRM personnels, Strava et sessions sont effacés. Ses messages du groupe, conversations et tracés partagés restent visibles sous « Membre supprimé ».
            </div>
          </div>
          <label className="ad-field">
            <span>
              Pour confirmer, tape l'adresse <strong>{t?.email}</strong>
            </span>
            <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" required autoFocus />
          </label>
          <label className="ad-field">
            <span>Ton mot de passe</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        </>
      )}
      {error && (
        <p className="ad-form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );

  return { open, dialog };
}
