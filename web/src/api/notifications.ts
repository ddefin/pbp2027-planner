import { ApiError } from "./auth";

export interface AppNotification {
  id: string;
  kind: string;
  message: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as T;
}

export function listNotifications() {
  return request<{ notifications: AppNotification[]; unreadCount: number }>("/notifications");
}

export function markNotificationRead(id: string) {
  return request<void>(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return request<void>("/notifications/read-all", { method: "POST" });
}
