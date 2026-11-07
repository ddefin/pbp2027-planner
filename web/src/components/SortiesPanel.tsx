import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useSorties } from "../hooks/useSorties";
import { useChat } from "../hooks/useChat";

export function SortiesPanel() {
  const { user } = useAuth();
  const { sorties, loading, error, create, toggleJoin } = useSorties();
  const [active, setActive] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!active && sorties && sorties.length > 0) setActive(sorties[0].id);
  }, [sorties, active]);

  const current = sorties?.find((s) => s.id === active) ?? null;

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>Coordination des sorties</h2>
        <button type="button" className="ghost" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Planifier une sortie"}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {showForm && (
        <SortieForm
          onSubmit={async (input) => {
            const sortie = await create(input);
            setActive(sortie.id);
            setShowForm(false);
          }}
        />
      )}

      {loading && <p className="hint">Chargement…</p>}
      {!loading && sorties && sorties.length === 0 && !showForm && (
        <p className="hint">Aucune sortie planifiée pour l'instant.</p>
      )}

      {!loading && sorties && sorties.length > 0 && (
        <div className="sorties-grid">
          <div className="sortie-list">
            {sorties.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sortie${s.id === active ? " active" : ""}`}
                onClick={() => setActive(s.id)}
              >
                <div>
                  <div className="title">{s.titre}</div>
                  <div className="sub tabular">
                    {new Date(s.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {s.lieu}
                  </div>
                </div>
                <div className="avatars">
                  {s.participants.map((p, i) => (
                    <div className="av" key={i}>
                      {p.slice(0, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>

          {current && <ChatPanel key={current.id} sortieId={current.id} titre={current.titre} joined={current.joined} onToggleJoin={() => toggleJoin(current.id, current.joined)} myEmail={user?.email} />}
        </div>
      )}
    </section>
  );
}

function SortieForm({ onSubmit }: { onSubmit: (input: { titre: string; date: string; lieu: string }) => Promise<void> }) {
  const [titre, setTitre] = useState("");
  const [date, setDate] = useState("");
  const [lieu, setLieu] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !date || !lieu.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ titre: titre.trim(), date: new Date(date).toISOString(), lieu: lieu.trim() });
      setTitre("");
      setDate("");
      setLieu("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ background: "var(--bg)", marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sortie-titre">Titre</label>
          <input id="sortie-titre" required value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Sortie reco col du Perche" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sortie-date">Date et heure</label>
          <input id="sortie-date" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sortie-lieu">Lieu de départ</label>
          <input id="sortie-lieu" required value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Rambouillet" />
        </div>
      </div>
      <button className="primary" type="submit" disabled={busy} style={{ marginTop: 14, width: "auto", padding: "10px 20px" }}>
        {busy ? "Création…" : "Planifier"}
      </button>
    </form>
  );
}

function ChatPanel({
  sortieId,
  titre,
  joined,
  onToggleJoin,
  myEmail,
}: {
  sortieId: string;
  titre: string;
  joined: boolean;
  onToggleJoin: () => void;
  myEmail: string | undefined;
}) {
  const { messages, status, send } = useChat(sortieId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const myName = myEmail?.split("@")[0];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    send(text);
    setDraft("");
  }

  return (
    <div className="chat">
      <div className="chat-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          {titre} {status !== "open" && <span className="hint" style={{ margin: 0 }}>· {status === "connecting" ? "connexion…" : "déconnecté"}</span>}
        </span>
        <button type="button" className="ghost" onClick={onToggleJoin} style={{ padding: "4px 10px", fontSize: 11.5 }}>
          {joined ? "Se désinscrire" : "Participer"}
        </button>
      </div>
      <div className="chat-msgs" ref={scrollRef}>
        {messages.map((m) => (
          <div className={`msg${m.who === myName ? " me" : ""}`} key={m.id}>
            <div className="who">{m.who}</div>
            <div className="bubble">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Écrire un message à l'équipe…"
          disabled={status !== "open"}
        />
        <button type="button" onClick={handleSend} disabled={status !== "open"}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
