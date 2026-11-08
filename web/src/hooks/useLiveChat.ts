import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "connecting" | "open" | "closed";

// Générique derrière useChat (sorties) et le salon général / messages privés : ouvre
// un socket sur `socketUrl`, charge l'historique via `loadHistory`, et ajoute les
// messages reçus au fil de l'eau. `key` déclenche une reconnexion (ex. changer de
// conversation privée). Un envoi via REST (pièce jointe, position) arrive aussi par
// ce canal : l'auteur est lui-même connecté à la room, donc reçoit sa propre
// diffusion comme n'importe quel autre participant — pas d'insertion optimiste
// séparée à gérer pour ces cas-là.
export function useLiveChat<M extends { id: string }>(
  key: string | null,
  socketUrl: string | null,
  loadHistory: () => Promise<M[]>,
) {
  const [messages, setMessages] = useState<M[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!key || !socketUrl) return;
    let cancelled = false;
    setStatus("connecting");
    setMessages([]);

    loadHistory()
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => undefined);

    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!cancelled) setStatus("open");
    });
    socket.addEventListener("close", () => {
      if (!cancelled) setStatus("closed");
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "message") {
          setMessages((prev) => [...prev, payload as M]);
        } else if (payload.type === "message_deleted" && typeof payload.id === "string") {
          setMessages((prev) => prev.filter((m) => m.id !== payload.id));
        }
      } catch {
        // message non reconnu, ignoré
      }
    });

    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, socketUrl]);

  const send = useCallback((text: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ text }));
  }, []);

  // Retrait local immédiat (optimiste) : la diffusion "message_deleted" qui revient
  // par WS confirme/synchronise ensuite, y compris pour l'auteur lui-même.
  const removeLocal = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { messages, status, send, removeLocal };
}
