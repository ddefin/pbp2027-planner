import { useState, type FormEvent } from "react";
import type { BrmDistance, BrmEvent, BrmStatus } from "../api/brm";
import type { useBrmEvents } from "../hooks/useBrmEvents";
import { STATUS_LABEL, STATUS_OPTIONS, VALID_DISTANCES, formatMinutes } from "../lib/brmMeta";

export function BrmTracker({ brm }: { brm: ReturnType<typeof useBrmEvents> }) {
  const { events, loading, error, create, update, remove } = brm;
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>Suivi des BRM de qualification</h2>
        <button type="button" className="ghost" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Ajouter un BRM"}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {showForm && <BrmForm onSubmit={async (input) => { await create(input); setShowForm(false); }} />}

      {loading && <p className="hint">Chargement…</p>}
      {!loading && events && events.length === 0 && !showForm && (
        <p className="hint">Aucun BRM enregistré pour l'instant. Ajoute ta première inscription.</p>
      )}

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

function BrmForm({ onSubmit }: { onSubmit: (input: { distance: BrmDistance; date: string; lieu: string }) => Promise<void> }) {
  const [distance, setDistance] = useState<BrmDistance>(200);
  const [date, setDate] = useState("");
  const [lieu, setLieu] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date || !lieu.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ distance, date: new Date(date).toISOString(), lieu: lieu.trim() });
      setDate("");
      setLieu("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ background: "var(--bg)", marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="brm-distance">Distance</label>
          <select
            id="brm-distance"
            value={distance}
            onChange={(e) => setDistance(Number(e.target.value) as BrmDistance)}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "10px 12px",
              color: "var(--fg)",
              fontFamily: "inherit",
            }}
          >
            {VALID_DISTANCES.map((d) => (
              <option key={d} value={d}>
                {d} km
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="brm-date">Date</label>
          <input id="brm-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="brm-lieu">Lieu</label>
          <input id="brm-lieu" type="text" required value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Rambouillet" />
        </div>
      </div>
      <button className="primary" type="submit" disabled={busy} style={{ marginTop: 14, width: "auto", padding: "10px 20px" }}>
        {busy ? "Ajout…" : "Ajouter"}
      </button>
    </form>
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
    </div>
  );
}
