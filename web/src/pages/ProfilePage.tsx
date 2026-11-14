import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useProfile } from "../hooks/useProfile";
import { usePersonalEvents } from "../hooks/usePersonalEvents";
import { useLicenseDocuments } from "../hooks/useLicenseDocuments";
import { ApiError } from "../api/auth";
import { StravaTab } from "../components/strava/StravaTab";
import { AvatarPicker } from "../components/AvatarPicker";
import {
  changePassword,
  createTelegramLinkCode,
  getTelegramStatus,
  licenseFileUrl,
  unlinkTelegram,
  type TelegramStatus,
} from "../api/profile";

// pdf.js (~350 Ko) n'a aucune raison d'alourdir le chargement initial de toute
// l'app pour tout le monde — chargé à la demande seulement quand une licence PDF
// est effectivement affichée (voir Suspense dans LicensePreview ci-dessous).
const PdfPreview = lazy(() => import("../components/PdfPreview").then((m) => ({ default: m.PdfPreview })));

// Replié par défaut (sauf la première section) : quatre blocs complets l'un sous
// l'autre forçaient beaucoup de défilement avant même de voir ce qu'on cherche.
function CollapsibleSection({ title, summary, defaultOpen = false, children }: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel">
      <button type="button" className="collapsible-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="collapsible-text">
          <h2>{title}</h2>
          {!open && summary && <span className="collapsible-sub">{summary}</span>}
        </span>
        <span className={`collapsible-caret${open ? " open" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </section>
  );
}

type ProfileTab = "compte" | "strava";

export function ProfilePage() {
  const [tab, setTab] = useState<ProfileTab>(() => (window.location.hash === "#strava" || new URLSearchParams(window.location.search).has("strava") ? "strava" : "compte"));
  const go = (t: ProfileTab) => {
    setTab(t);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${t === "strava" ? "#strava" : ""}`);
  };
  return (
    <div className="wrap">
      <nav className="rb-tabs" role="tablist" aria-label="Sections du profil">
        <button type="button" role="tab" id="pf-tab-compte" aria-selected={tab === "compte"} aria-controls="pf-panel-compte" className="rb-tab" onClick={() => go("compte")}>
          👤 Compte
        </button>
        <button type="button" role="tab" id="pf-tab-strava" aria-selected={tab === "strava"} aria-controls="pf-panel-strava" className="rb-tab" onClick={() => go("strava")}>
          🚴 Strava
        </button>
      </nav>
      {tab === "strava" && (
        <div role="tabpanel" id="pf-panel-strava" aria-labelledby="pf-tab-strava">
          <StravaTab />
        </div>
      )}
      <div role="tabpanel" id="pf-panel-compte" aria-labelledby="pf-tab-compte" hidden={tab !== "compte"}>
      <CollapsibleSection title="Mon avatar" summary="Photo ou icône, visible des autres membres">
        <AvatarPicker />
      </CollapsibleSection>
      <CollapsibleSection title="Mon profil" summary="Prénom, adresse e-mail">
        <ProfileSection />
      </CollapsibleSection>
      <CollapsibleSection title="Ma licence" summary="Numéro, club, justificatif">
        <LicenseSection />
      </CollapsibleSection>
      <CollapsibleSection title="Mot de passe" summary="Changer ton mot de passe">
        <PasswordSection />
      </CollapsibleSection>
      <CollapsibleSection title="Carnet de bord" summary="Matériel, nutrition, notes de brevet">
        <NotebookSection />
      </CollapsibleSection>
      <CollapsibleSection title="Mes événements" summary="Tes sorties perso dans le calendrier">
        <PersonalEventsSection />
      </CollapsibleSection>
      <CollapsibleSection title="Telegram" summary="Notifications et pointage par message">
        <TelegramSection />
      </CollapsibleSection>
      </div>
      <DeployedVersion />
    </div>
  );
}

function ProfileSection() {
  const { refresh: refreshSession } = useAuth();
  const { profile, loading, update } = useProfile();
  const [prenom, setPrenom] = useState("");
  const [licenceNumero, setLicenceNumero] = useState("");
  const [club, setClub] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setPrenom(profile.prenom);
    setLicenceNumero(profile.licenceNumero ?? "");
    setClub(profile.club ?? "");
  }, [profile]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await update({ prenom, licenceNumero: licenceNumero || null, club: club || null });
      await refreshSession();
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        Chargement…
      </p>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="profile-email">Email</label>
          <input id="profile-email" type="email" value={profile.email} disabled />
        </div>
        <div className="field">
          <label htmlFor="profile-prenom">Prénom</label>
          <input id="profile-prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="profile-licence">Numéro de licence (FFCT/ACP)</label>
          <input
            id="profile-licence"
            value={licenceNumero}
            onChange={(e) => setLicenceNumero(e.target.value)}
            maxLength={40}
            placeholder="Optionnel"
          />
        </div>
        <div className="field">
          <label htmlFor="profile-club">Club</label>
          <input id="profile-club" value={club} onChange={(e) => setClub(e.target.value)} maxLength={120} placeholder="Optionnel" />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && (
          <span className="hint" style={{ marginLeft: 12, marginTop: 0, marginBottom: 0 }}>
            Enregistré.
          </span>
        )}
      </form>
    </>
  );
}

const PASSWORD_ERROR_MESSAGES: Record<string, string> = {
  invalid_current_password: "Mot de passe actuel incorrect.",
  invalid_input: "Le nouveau mot de passe doit faire au moins 10 caractères.",
};

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (PASSWORD_ERROR_MESSAGES[err.code] ?? "Une erreur est survenue.") : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="current-password">Mot de passe actuel</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">Nouveau mot de passe (10 caractères min.)</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirmer</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Changement…" : "Changer le mot de passe"}
        </button>
        {done && (
          <span className="hint" style={{ marginLeft: 12, marginTop: 0, marginBottom: 0 }}>
            Mot de passe changé.
          </span>
        )}
      </form>
    </>
  );
}

function NotebookSection() {
  const { profile, loading, update } = useProfile();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) setText(profile.notebook ?? "");
  }, [profile]);

  async function handleSave() {
    setBusy(true);
    setSaved(false);
    try {
      await update({ notebook: text || null });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Notes libres rien que pour toi — liste de matériel, plan de nutrition, points de vigilance pour le brevet...
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        style={{
          width: "100%",
          resize: "vertical",
          background: "var(--bg)",
          color: "var(--fg)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 10,
          fontFamily: "inherit",
          fontSize: 14,
        }}
      />
      <div style={{ marginTop: 10 }}>
        <button className="primary" type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && (
          <span className="hint" style={{ marginLeft: 12, marginTop: 0, marginBottom: 0 }}>
            Enregistré.
          </span>
        )}
      </div>
    </>
  );
}

function PersonalEventsSection() {
  const { events, loading, add, remove } = usePersonalEvents();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date) return;
    setBusy(true);
    try {
      await add({ title: title.trim(), date, notes: notes.trim() || null });
      setTitle("");
      setDate("");
      setNotes("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Un calendrier rien qu'à toi — entraînements, rendez-vous, rappels liés au PBP. Visible seulement par toi.
      </p>

      {loading && <p className="hint">Chargement…</p>}
      {!loading && events && events.length === 0 && <p className="hint">Aucun événement pour l'instant.</p>}

      {!loading && events && events.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {events.map((ev) => (
            <div key={ev.id} className="security-row">
              <div>
                <div className="t">
                  {new Date(ev.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })} — {ev.title}
                </div>
                {ev.notes && <div className="d">{ev.notes}</div>}
              </div>
              <button type="button" className="ghost" onClick={() => remove(ev.id)}>
                Supprimer
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
          <label htmlFor="event-date">Date</label>
          <input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label htmlFor="event-title">Titre</label>
          <input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={150} />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 2, minWidth: 220 }}>
          <label htmlFor="event-notes">Notes</label>
          <input id="event-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optionnel" />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ height: 38 }}>
          Ajouter
        </button>
      </form>
    </>
  );
}

function LicensePreview({ fileName, fileMimeType, id }: { fileName: string; fileMimeType: string; id: string }) {
  const url = licenseFileUrl(id);

  // Image : affichée telle quelle dans le cadre. PDF : rendu en <canvas> via pdf.js
  // (PdfPreview) plutôt qu'une <iframe> — le support natif des PDF en <iframe> est
  // peu fiable sur mobile (Safari iOS en particulier peut rester silencieusement
  // vide). Un lien "ouvrir dans un nouvel onglet" reste en repli dans tous les cas.
  return (
    <div>
      {fileMimeType.startsWith("image/") ? (
        <div className="license-frame">
          <img src={url} alt={fileName} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
      ) : (
        <Suspense fallback={<p className="hint" style={{ margin: 0 }}>Chargement de l'aperçu…</p>}>
          <PdfPreview url={url} />
        </Suspense>
      )}
      <a href={url} target="_blank" rel="noreferrer" className="hint" style={{ display: "inline-block", marginTop: 6, marginBottom: 0, textDecoration: "underline" }}>
        Ouvrir dans un nouvel onglet ↗
      </a>
    </div>
  );
}

function LicenseSection() {
  const { documents, loading, error, upload, remove } = useLicenseDocuments();
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

  if (loading) return null;

  const [current, ...archive] = documents ?? [];

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Scan ou photo de ta licence FFCT/ACP (PDF, PNG ou JPEG, 10 Mo max). Chaque import garde le précédent dans
        l'archive plutôt que de l'effacer — pratique pour retrouver tes licences des années passées.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {current ? (
        <div>
          <LicensePreview fileName={current.fileName} fileMimeType={current.fileMimeType} id={current.id} />
          <p className="hint" style={{ marginBottom: 0 }}>
            Ajoutée le {new Date(current.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
      ) : (
        <p className="hint">Aucune licence enregistrée pour l'instant.</p>
      )}

      <button
        type="button"
        className="ghost"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        style={{ marginTop: 10 }}
      >
        {busy ? "Import…" : current ? "Changer de licence" : "Ajouter ma licence"}
      </button>
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden onChange={handleFileChange} />

      {archive.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="hint" style={{ margin: "0 0 6px", fontWeight: 700 }}>
            Archive ({archive.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {archive.map((d) => (
              <div key={d.id} className="security-row">
                <div>
                  <div className="t">
                    <a href={licenseFileUrl(d.id)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                      📄 {d.fileName}
                    </a>
                  </div>
                  <div className="d">
                    {new Date(d.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                </div>
                <button type="button" className="ghost" onClick={() => remove(d.id)}>
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getTelegramStatus());
    } catch {
      setError("Impossible de récupérer le statut Telegram.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Pendant qu'un code est affiché (en attente d'être envoyé au bot), vérifie
  // périodiquement si la liaison a été faite entre-temps — évite d'avoir à
  // recharger la page après avoir envoyé /start au bot sur son téléphone.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(async () => {
      const s = await getTelegramStatus().catch(() => null);
      if (s?.linked) {
        setStatus(s);
        setCode(null);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [code]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const result = await createTelegramLinkCode();
      setCode(result.code);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "not_configured"
          ? "Le bot Telegram n'est pas configuré sur ce serveur."
          : "Impossible de générer un code, réessaie.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (!confirm("Délier ton compte Telegram ? Tu ne recevras plus les notifications personnalisées par ce canal.")) return;
    setBusy(true);
    try {
      await unlinkTelegram();
      setStatus((prev) => (prev ? { ...prev, linked: false, linkedAt: null } : prev));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (!status.configured) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        Le bot Telegram n'est pas configuré sur ce serveur (variable TELEGRAM_BOT_TOKEN absente) — demande à
        l'administrateur si tu veux recevoir tes notifications par Telegram.
      </p>
    );
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Reçois en message privé tes notifications personnalisées (changement de statut sur un BRM choisi), en plus de
        la cloche de l'application.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {status.linked ? (
        <div className="security-row">
          <div className="t">✅ Compte Telegram lié{status.linkedAt && ` depuis le ${new Date(status.linkedAt).toLocaleDateString("fr-FR")}`}</div>
          <button type="button" className="ghost" onClick={handleUnlink} disabled={busy}>
            Délier
          </button>
        </div>
      ) : code ? (
        <div>
          <p style={{ marginTop: 0 }}>
            {status.botUsername ? (
              <a
                className="primary"
                style={{ display: "inline-block", width: "auto", padding: "10px 20px", textDecoration: "none" }}
                href={`https://t.me/${status.botUsername}?start=${code}`}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir Telegram et lier mon compte
              </a>
            ) : (
              <>
                Ouvre Telegram, cherche le bot configuré par l'administrateur, puis envoie :{" "}
                <code style={{ padding: "2px 6px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6 }}>
                  /start {code}
                </code>
              </>
            )}
          </p>
          <p className="hint">Code valable 15 minutes. Cette page se met à jour automatiquement une fois lié.</p>
        </div>
      ) : (
        <button type="button" className="primary" style={{ width: "auto", padding: "10px 20px" }} onClick={handleGenerate} disabled={busy}>
          {busy ? "Génération…" : "Lier mon compte Telegram"}
        </button>
      )}
    </>
  );
}

// Version réellement en service sur le serveur (fournie au build par
// scripts/auto-deploy.sh) : permet de vérifier d'un coup d'œil qu'une mise à jour a
// bien été déployée, sans passer par le terminal du NAS.
function DeployedVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((b: { version?: string }) => setVersion(b.version ?? null))
      .catch(() => undefined);
  }, []);
  if (!version) return null;
  return (
    <p className="hint" style={{ textAlign: "center", marginTop: 8 }}>
      Version déployée : <span className="tabular">{version}</span>
    </p>
  );
}
