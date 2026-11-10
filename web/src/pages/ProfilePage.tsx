import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useProfile } from "../hooks/useProfile";
import { usePersonalEvents } from "../hooks/usePersonalEvents";
import { ApiError } from "../api/auth";
import { changePassword } from "../api/profile";

export function ProfilePage() {
  return (
    <div className="wrap">
      <ProfileSection />
      <PasswordSection />
      <NotebookSection />
      <PersonalEventsSection />
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
      <section className="panel">
        <h2>Mon profil</h2>
        <p className="hint" style={{ margin: 0 }}>
          Chargement…
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Mon profil</h2>
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
    </section>
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
    <section className="panel">
      <h2>Mot de passe</h2>
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
    </section>
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
    <section className="panel">
      <h2>Carnet de bord</h2>
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
    </section>
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
    <section className="panel">
      <h2>Mes événements</h2>
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
    </section>
  );
}
