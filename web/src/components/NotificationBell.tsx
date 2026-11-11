import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../hooks/useNotifications";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleItemClick(n: { id: string; link: string | null; read: boolean }) {
    if (!n.read) await markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => markAllRead()}>
                Tout marquer lu
              </button>
            )}
          </div>
          {!notifications || notifications.length === 0 ? (
            <p className="hint" style={{ padding: 14, margin: 0 }}>
              Rien pour l'instant.
            </p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notif-item${n.read ? "" : " unread"}`}
                style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer" }}
                onClick={() => handleItemClick(n)}
              >
                <div>{n.message}</div>
                <div className="notif-item-date">{formatDate(n.createdAt)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
