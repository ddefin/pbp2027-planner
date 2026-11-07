import { useEffect, useRef, useState } from "react";
import { SEED_MESSAGES, SORTIES, type ChatMessage } from "../lib/brmPlan";
import { useAuth } from "../context/AuthContext";

export function SortiesPanel() {
  const { user } = useAuth();
  const [active, setActive] = useState(SORTIES[0].id);
  const [msgsBySortie, setMsgsBySortie] = useState<Record<string, ChatMessage[]>>(SEED_MESSAGES);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgsBySortie, active]);

  const current = SORTIES.find((s) => s.id === active)!;
  const msgs = msgsBySortie[active] ?? [];

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMsgsBySortie((prev) => ({
      ...prev,
      [active]: [...(prev[active] ?? []), { who: user?.email ?? "Moi", me: true, text }],
    }));
    setDraft("");
  }

  return (
    <section className="panel">
      <h2>Coordination des sorties</h2>
      <div className="sorties-grid">
        <div className="sortie-list">
          {SORTIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sortie${s.id === active ? " active" : ""}`}
              onClick={() => setActive(s.id)}
            >
              <div>
                <div className="title">{s.titre}</div>
                <div className="sub tabular">
                  {s.date} · {s.lieu}
                </div>
              </div>
              <div className="avatars">
                {s.participants.map((p, i) => (
                  <div className="av" key={i}>
                    {p}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className="chat">
          <div className="chat-head">{current.titre}</div>
          <div className="chat-msgs" ref={scrollRef}>
            {msgs.map((m, i) => (
              <div className={`msg${m.me ? " me" : ""}`} key={i}>
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
                if (e.key === "Enter") send();
              }}
              placeholder="Écrire un message à l'équipe…"
            />
            <button type="button" onClick={send}>
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
