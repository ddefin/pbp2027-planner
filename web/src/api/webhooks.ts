import { ApiError } from "./auth";

export type WebhookFormat = "discord" | "slack" | "generic";
export type WebhookEventName = "brm.participation_changed" | "meteo.vent_fort";

export interface Webhook {
  id: string;
  url: string;
  format: WebhookFormat;
  events: WebhookEventName[];
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  lastStatus: "ok" | "error" | null;
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

export function listWebhooks() {
  return request<{ webhooks: Webhook[] }>("/webhooks").then((r) => r.webhooks);
}

export function createWebhook(input: { url: string; format: WebhookFormat; events: WebhookEventName[] }) {
  return request<{ webhook: Webhook; secret: string | null }>("/webhooks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWebhook(id: string, input: { enabled?: boolean; events?: WebhookEventName[] }) {
  return request<{ webhook: Webhook }>(`/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
    (r) => r.webhook,
  );
}

export function deleteWebhook(id: string) {
  return request<void>(`/webhooks/${id}`, { method: "DELETE" });
}

export function testWebhook(id: string) {
  return request<{ lastStatus: "ok" | "error" | null }>(`/webhooks/${id}/test`, { method: "POST" });
}
