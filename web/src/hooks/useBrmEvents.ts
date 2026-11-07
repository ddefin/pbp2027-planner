import { useCallback, useEffect, useState } from "react";
import {
  createBrmEvent,
  deleteBrmEvent,
  listBrmEvents,
  updateBrmEvent,
  type BrmEvent,
  type CreateBrmInput,
  type UpdateBrmInput,
} from "../api/brm";

function byDate(a: BrmEvent, b: BrmEvent): number {
  return a.date.localeCompare(b.date);
}

export function useBrmEvents() {
  const [events, setEvents] = useState<BrmEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listBrmEvents();
      setEvents(list.sort(byDate));
    } catch {
      setError("Impossible de charger les BRM.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (input: CreateBrmInput) => {
    const event = await createBrmEvent(input);
    setEvents((prev) => [...(prev ?? []), event].sort(byDate));
  }, []);

  const update = useCallback(async (id: string, input: UpdateBrmInput) => {
    const event = await updateBrmEvent(id, input);
    setEvents((prev) => (prev ?? []).map((e) => (e.id === id ? event : e)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteBrmEvent(id);
    setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
  }, []);

  return { events, loading: events === null && !error, error, refresh, create, update, remove };
}
