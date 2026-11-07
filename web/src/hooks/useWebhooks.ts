import { useCallback, useEffect, useState } from "react";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
  type Webhook,
  type WebhookEventName,
  type WebhookFormat,
} from "../api/webhooks";

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setWebhooks(await listWebhooks());
    } catch {
      setError("Impossible de charger les webhooks.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (input: { url: string; format: WebhookFormat; events: WebhookEventName[] }) => {
    const result = await createWebhook(input);
    setWebhooks((prev) => [result.webhook, ...(prev ?? [])]);
    return result;
  }, []);

  const toggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    const updated = await updateWebhook(id, { enabled });
    setWebhooks((prev) => (prev ?? []).map((w) => (w.id === id ? updated : w)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteWebhook(id);
    setWebhooks((prev) => (prev ?? []).filter((w) => w.id !== id));
  }, []);

  const test = useCallback(async (id: string) => {
    const result = await testWebhook(id);
    setWebhooks((prev) => (prev ?? []).map((w) => (w.id === id ? { ...w, lastStatus: result.lastStatus, lastTriggeredAt: new Date().toISOString() } : w)));
    return result.lastStatus;
  }, []);

  return { webhooks, loading: webhooks === null && !error, error, refresh, create, toggleEnabled, remove, test };
}
