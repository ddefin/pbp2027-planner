import { useCallback, useEffect, useState } from "react";
import { createPersonalEvent, deletePersonalEvent, listPersonalEvents, type PersonalEvent } from "../api/profile";

export function usePersonalEvents() {
  const [events, setEvents] = useState<PersonalEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await listPersonalEvents());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (data: { title: string; date: string; notes?: string | null }) => {
    const event = await createPersonalEvent(data);
    setEvents((prev) => [...(prev ?? []), event].sort((a, b) => a.date.localeCompare(b.date)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deletePersonalEvent(id);
    setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
  }, []);

  return { events, loading, add, remove };
}
