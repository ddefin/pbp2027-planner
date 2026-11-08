import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useGeneralChat } from "../hooks/useGeneralChat";
import { useConversations, useDirectThread } from "../hooks/useDirectMessages";
import type { ChatStatus } from "../hooks/useLiveChat";
import type { ChatMessage, DmMessage } from "../api/messaging";

type Tab = "general" | "prive";

export function MessagesPanel() {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <section className="panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button type="button" className={`ghost${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>
          Salon général
        </button>
        <button type="button" className={`ghost${tab === "prive" ? " active" : ""}`} onClick={() => setTab("prive")}>
          Messages privés
        </button>
      </div>

      {tab === "general" ? <GeneralTab /> : <PrivateTab />}
    </section>
  );
}

function GeneralTab() {
  const { user } = useAuth();
  const chat = useGeneralChat();

  return (
    <div style={{ maxWidth: 640 }}>
      <ChatThread title="Salon général" status={chat.status} messages={chat.messages} myName={user?.prenom} send={chat.send} />
    </div>
  );
}

function PrivateTab() {
  const { user } = useAuth();
  const { conversations, users, refresh } = useConversations();
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!active && conversations && conversations.length > 0) setActive(conversations[0].peerId);
  }, [conversations, active]);

  const thread = useDirectThread(active);

  // Quand on ouvre une conversation, son compteur de non-lus doit retomber à 0 —
  // le backend marque les messages comme lus à la lecture de l'historique, donc on
  // resynchronise juste la liste.
  useEffect(() => {
    if (active) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const activeConversation = conversations?.find((c) => c.peerId === active);
  const activeUser = users?.find((u) => u.id === active);
  const activeName = activeConversation?.prenom ?? activeUser?.prenom;

  const usersWithoutConversation = (users ?? []).filter((u) => !(conversations ?? []).some((c) => c.peerId === u.id));

  return (
    <div className="sorties-grid">
      <div className="sortie-list">
        {conversations && conversations.length === 0 && usersWithoutConversation.length === 0 && (
          <p className="hint">Pas d'autre randonneur inscrit pour l'instant.</p>
        )}

        {(conversations ?? []).map((c) => (
          <button key={c.peerId} type="button" className={`sortie${c.peerId === active ? " active" : ""}`} onClick={() => setActive(c.peerId)}>
            <div>
              <div className="title">
                {c.prenom}
                {c.unread > 0 && (
                  <span className="pill" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}>
                    {c.unread}
                  </span>
                )}
              </div>
              <div className="sub">{c.lastText.length > 48 ? `${c.lastText.slice(0, 48)}…` : c.lastText}</div>
            </div>
          </button>
        ))}

        {usersWithoutConversation.length > 0 && (
          <>
            <div className="hint" style={{ margin: "10px 0 4px" }}>Nouveau message</div>
            {usersWithoutConversation.map((u) => (
              <button key={u.id} type="button" className={`sortie${u.id === active ? " active" : ""}`} onClick={() => setActive(u.id)}>
                <div className="title">{u.prenom}</div>
              </button>
            ))}
          </>
        )}
      </div>

      {active ? (
        <DmThread title={activeName ?? "…"} status={thread.status} messages={thread.messages} peerId={active} send={thread.send} />
      ) : (
        <div className="chat">
          <p className="hint" style={{ padding: 16 }}>Choisis un randonneur pour démarrer une conversation.</p>
        </div>
      )}
    </div>
  );
}

function ChatThread({
  title,
  status,
  messages,
  myName,
  send,
}: {
  title: string;
  status: ChatStatus;
  messages: ChatMessage[];
  myName: string | undefined;
  send: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <div className="chat-head">
        <span>
          {title} {status !== "open" && <span className="hint" style={{ margin: 0 }}>· {status === "connecting" ? "connexion…" : "déconnecté"}</span>}
        </span>
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
          placeholder="Écrire un message…"
          disabled={status !== "open"}
        />
        <button type="button" onClick={handleSend} disabled={status !== "open"}>
          Envoyer
        </button>
      </div>
    </div>
  );
}

function DmThread({
  title,
  status,
  messages,
  peerId,
  send,
}: {
  title: string;
  status: ChatStatus;
  messages: DmMessage[];
  peerId: string;
  send: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <div className="chat-head">
        <span>
          {title} {status !== "open" && <span className="hint" style={{ margin: 0 }}>· {status === "connecting" ? "connexion…" : "déconnecté"}</span>}
        </span>
      </div>
      <div className="chat-msgs" ref={scrollRef}>
        {messages.map((m) => (
          // Expéditeur ≠ l'interlocuteur ⇒ c'est un message qu'on a envoyé soi-même.
          <div className={`msg${m.fromUserId !== peerId ? " me" : ""}`} key={m.id}>
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
          placeholder="Écrire un message…"
          disabled={status !== "open"}
        />
        <button type="button" onClick={handleSend} disabled={status !== "open"}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
