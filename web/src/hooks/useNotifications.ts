import { useCallback, useEffect, useState } from "react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from "../api/notifications";

// Rafraîchi au montage puis toutes les POLL_INTERVAL_MS : pas de WebSocket dédié
// pour quelque chose d'aussi occasionnel qu'un changement de statut BRM — un
// polling discret suffit, la messagerie (plus fréquente) a déjà le WebSocket.
const POLL_INTERVAL_MS = 60_000;

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await listNotifications();
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // Silencieux : la cloche de notification n'est pas une fonctionnalité
      // critique, une erreur réseau ponctuelle ne doit pas s'afficher partout.
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => (prev ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await markNotificationRead(id);
    } catch {
      await refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => (prev ?? []).map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      await refresh();
    }
  }, [refresh]);

  return { notifications, unreadCount, refresh, markRead, markAllRead };
}
