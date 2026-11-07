import { useCallback, useEffect, useRef, useState } from "react";
import { chatSocketUrl, listMessages, type ChatMessage } from "../api/sorties";

export type ChatStatus = "connecting" | "open" | "closed";

export function useChat(sortieId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sortieId) return;
    let cancelled = false;
    setStatus("connecting");
    setMessages([]);

    listMessages(sortieId)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => undefined);

    const socket = new WebSocket(chatSocketUrl(sortieId));
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
          setMessages((prev) => [...prev, payload]);
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
  }, [sortieId]);

  const send = useCallback((text: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ text }));
  }, []);

  return { messages, status, send };
}
