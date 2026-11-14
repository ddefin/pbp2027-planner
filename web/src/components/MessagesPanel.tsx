import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { useGeneralChat } from "../hooks/useGeneralChat";
import { useConversations, useDirectThread } from "../hooks/useDirectMessages";
import type { ChatStatus } from "../hooks/useLiveChat";
import {
  deleteDmMessage,
  deleteGeneralMessage,
  dmFileUrl,
  generalFileUrl,
  sendDmLocation,
  sendGeneralLocation,
  uploadDmFile,
  uploadGeneralFile,
  type ChatMessage,
  type DmMessage,
} from "../api/messaging";

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
      <ChatThread
        title="Salon général"
        status={chat.status}
        messages={chat.messages}
        myName={user?.prenom}
        send={chat.send}
        onDelete={async (id) => {
          chat.removeLocal(id);
          await deleteGeneralMessage(id).catch(() => undefined);
        }}
        onSendLocation={(lat, lon) => sendGeneralLocation(lat, lon)}
        onUploadFile={(file) => uploadGeneralFile(file)}
        fileUrl={generalFileUrl}
      />
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
    <div className={`sorties-grid${active ? " has-active" : ""}`}>
      <div className="sortie-list">
        {conversations && conversations.length === 0 && usersWithoutConversation.length === 0 && (
          <p className="hint">Pas d'autre randonneur inscrit pour l'instant.</p>
        )}

        {(conversations ?? []).map((c) => (
          <button key={c.peerId} type="button" className={`sortie${c.peerId === active ? " active" : ""}`} onClick={() => setActive(c.peerId)}>
            <div>
              <div className="title">
                <Avatar name={c.prenom} avatar={c.avatar} size={24} /> {c.prenom}
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
                <div className="title">
                  <Avatar name={u.prenom} avatar={u.avatar} size={24} /> {u.prenom}
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="chat-wrap">
        {active ? (
          <DmThread
            title={activeName ?? "…"}
            status={thread.status}
            messages={thread.messages}
            peerId={active}
            send={thread.send}
            onBack={() => setActive(null)}
            onDelete={async (id) => {
              thread.removeLocal(id);
              await deleteDmMessage(active, id).catch(() => undefined);
            }}
            onSendLocation={(lat, lon) => sendDmLocation(active, lat, lon)}
            onUploadFile={(file) => uploadDmFile(active, file)}
            fileUrl={(id) => dmFileUrl(active, id)}
          />
        ) : (
          <div className="chat">
            <p className="hint" style={{ padding: 16 }}>Choisis un randonneur pour démarrer une conversation.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Position, pour les deux liens "Voir sur la carte" (salon général et messages
// privés) : OpenStreetMap plutôt qu'un fournisseur à clé, cohérent avec le reste de
// l'app (carte des parcours).
function osmLink(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

function isImageMime(mime: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

// Contenu d'un message selon son type — partagé entre le salon général et les
// messages privés, qui n'ont que le wrapper (qui a écrit, bulle "moi"/"eux") en
// différent.
function MessageContent({ message, fileUrl }: { message: { kind: string; text: string; fileName: string | null; fileMimeType: string | null; lat: number | null; lon: number | null; id: string }; fileUrl: (id: string) => string }) {
  if (message.kind === "location" && message.lat !== null && message.lon !== null) {
    return (
      <a href={osmLink(message.lat, message.lon)} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
        📍 Position partagée — voir sur la carte
      </a>
    );
  }
  if (message.kind === "file" && message.fileName) {
    const url = fileUrl(message.id);
    if (isImageMime(message.fileMimeType)) {
      return (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={message.fileName} style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, display: "block" }} />
        </a>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="file-attachment-link" title={message.fileName} style={{ color: "inherit" }}>
        <span>📎</span>
        <span className="fname">{message.fileName}</span>
      </a>
    );
  }
  return <>{message.text}</>;
}

// Boutons pièce jointe / position, partagés entre salon général et messages privés.
function Composer({
  draft,
  setDraft,
  onSend,
  onUploadFile,
  onSendLocation,
  disabled,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onUploadFile: (file: File) => Promise<unknown>;
  onSendLocation: (lat: number, lon: number) => Promise<unknown>;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await onUploadFile(file);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleShareLocation() {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await onSendLocation(pos.coords.latitude, pos.coords.longitude);
        } finally {
          setBusy(false);
        }
      },
      () => setBusy(false),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  return (
    <div className="chat-input">
      <button type="button" className="chat-icon-btn" title="Joindre un fichier" onClick={() => fileInputRef.current?.click()} disabled={disabled || busy}>
        📎
      </button>
      <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
      <button type="button" className="chat-icon-btn" title="Partager ma position" onClick={handleShareLocation} disabled={disabled || busy}>
        📍
      </button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend();
        }}
        placeholder="Écrire un message…"
        disabled={disabled}
      />
      <button type="button" onClick={onSend} disabled={disabled}>
        Envoyer
      </button>
    </div>
  );
}

function ChatThread({
  title,
  status,
  messages,
  myName,
  send,
  onDelete,
  onSendLocation,
  onUploadFile,
  fileUrl,
}: {
  title: string;
  status: ChatStatus;
  messages: ChatMessage[];
  myName: string | undefined;
  send: (text: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSendLocation: (lat: number, lon: number) => Promise<unknown>;
  onUploadFile: (file: File) => Promise<unknown>;
  fileUrl: (id: string) => string;
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
        {messages.map((m) => {
          const mine = m.who === myName;
          return (
            <div className={`msg${mine ? " me" : ""}`} key={m.id}>
              <div className="who">
                <Avatar name={m.who} avatar={m.avatar} size={20} />
                {m.who}
                {mine && (
                  <button type="button" className="msg-delete" title="Supprimer" onClick={() => onDelete(m.id)}>
                    ×
                  </button>
                )}
              </div>
              <div className="bubble">
                <MessageContent message={m} fileUrl={fileUrl} />
              </div>
            </div>
          );
        })}
      </div>
      <Composer draft={draft} setDraft={setDraft} onSend={handleSend} onUploadFile={onUploadFile} onSendLocation={onSendLocation} disabled={status !== "open"} />
    </div>
  );
}

function DmThread({
  title,
  status,
  messages,
  peerId,
  send,
  onBack,
  onDelete,
  onSendLocation,
  onUploadFile,
  fileUrl,
}: {
  title: string;
  status: ChatStatus;
  messages: DmMessage[];
  peerId: string;
  send: (text: string) => void;
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onSendLocation: (lat: number, lon: number) => Promise<unknown>;
  onUploadFile: (file: File) => Promise<unknown>;
  fileUrl: (id: string) => string;
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
      <div className="chat-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="mobile-back" onClick={onBack} aria-label="Retour aux conversations">
          ←
        </button>
        <span>
          {title} {status !== "open" && <span className="hint" style={{ margin: 0 }}>· {status === "connecting" ? "connexion…" : "déconnecté"}</span>}
        </span>
      </div>
      <div className="chat-msgs" ref={scrollRef}>
        {messages.map((m) => {
          // Expéditeur ≠ l'interlocuteur ⇒ c'est un message qu'on a envoyé soi-même.
          const mine = m.fromUserId !== peerId;
          return (
            <div className={`msg${mine ? " me" : ""}`} key={m.id}>
              <div className="bubble">
                <MessageContent message={m} fileUrl={fileUrl} />
                {mine && (
                  <button type="button" className="msg-delete" title="Supprimer" onClick={() => onDelete(m.id)}>
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Composer draft={draft} setDraft={setDraft} onSend={handleSend} onUploadFile={onUploadFile} onSendLocation={onSendLocation} disabled={status !== "open"} />
    </div>
  );
}
