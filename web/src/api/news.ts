import { ApiError } from "./auth";

export type NewsSource = "acp" | "pbp";

export interface NewsItem {
  id: string;
  source: NewsSource;
  title: string;
  url: string;
  excerpt: string | null;
  imageUrl: string | null;
  publishedAt: string;
  discoveredAt: string;
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

export function listNews(params: { source?: NewsSource; q?: string } = {}) {
  const query = new URLSearchParams();
  if (params.source) query.set("source", params.source);
  if (params.q) query.set("q", params.q);
  const qs = query.toString();
  return request<{ items: NewsItem[]; lastUpdatedAt: string | null }>(`/news${qs ? `?${qs}` : ""}`);
}

export function refreshNews() {
  return request<{ added: number; checked: number }>("/news/refresh", { method: "POST" });
}
