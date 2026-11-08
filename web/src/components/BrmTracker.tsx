import { useState } from "react";
import { Link } from "react-router-dom";
import type { BrmEvent, BrmStatus } from "../api/brm";
import type { useBrmEvents } from "../hooks/useBrmEvents";
import { STATUS_LABEL, STATUS_OPTIONS, formatMinutes } from "../lib/brmMeta";

// La saisie manuelle (création) a été retirée : les BRM suivis ici viennent
// désormais des choix faits sur le calendrier (voir BrmChoicesOverview). Cette
// liste reste affichée pour les BRM déjà enregistrés par ce biais auparavant,
// avec leur suivi GPX/temps (voir ParcoursPage), le temps que cette fonctionnalité
// soit éventuellement reliée au calendrier.
export function BrmTracker({ brm }: { brm: ReturnType<typeof useBrmEvents> }) {
  const { events, loading, error, update, remove } = brm;

  if (!loading && (!events || events.length === 0)) return null;

  return (
    <section className="panel">
      <h2 style={{ marginBottom: 16 }}>Suivi GPX / temps réalisé</h2>

      {error && <div className="error-banner">{error}</div>}

      {loading && <p className="hint">Chargement…</p>}

      {!loading && events && events.length > 0 && (
        <div className="brm-grid">
          {events.map((ev) => (
            <BrmCard key={ev.id} event={ev} onUpdate={(input) => update(ev.id, input)} onDelete={() => remove(ev.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function BrmCard({
  event,
  onUpdate,
  onDelete,
}: {
  event: BrmEvent;
  onUpdate: (input: { status?: BrmStatus; tempsRealiseMinutes?: number | null }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleStatusChange(status: BrmStatus) {
    setBusy(true);
    try {
      await onUpdate({ status });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le BRM ${event.distance} km du ${event.date.slice(0, 10)} ?`)) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brm-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="dist">
          {event.distance} <small>km</small>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          aria-label="Supprimer"
          style={{ background: "none", border: "none", color: "var(--fg-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <select
        value={event.status}
        disabled={busy}
        onChange={(e) => handleStatusChange(e.target.value as BrmStatus)}
        className={`pill ${event.status}`}
        style={{ border: "none", marginTop: 8, cursor: "pointer" }}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      <div className="row">
        <span>Date</span>
        <b className="tabular">{event.date.slice(0, 10)}</b>
      </div>
      <div className="row">
        <span>Lieu</span>
        <b>{event.lieu}</b>
      </div>
      <div className="row">
        <span>Limite</span>
        <b className="tabular">{formatMinutes(event.limiteMinutes)}</b>
      </div>
      {event.tempsRealiseMinutes != null && (
        <div className="row">
          <span>Réalisé</span>
          <b className="tabular">{formatMinutes(event.tempsRealiseMinutes)}</b>
        </div>
      )}
      <Link to={`/brm/${event.id}/parcours`} className="hint" style={{ display: "block", marginTop: 10, textDecoration: "underline" }}>
        Parcours →
      </Link>
    </div>
  );
}
