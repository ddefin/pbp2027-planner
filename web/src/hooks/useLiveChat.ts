import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "connecting" | "open" | "closed";

// Générique derrière useChat (sorties) et le salon général / messages privés : ouvre
// un socket sur `socketUrl`, charge l'historique via `loadHistory`, et ajoute les
// messages reçus au fil de l'eau. `key` déclenche une reconnexion (ex. changer de
// conversation privée).
export function useLiveChat<M>(key: string | null, socketUrl: string | null, loadHistory: () => Promise<M[]>) {
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

  return { messages, status, send };
}
