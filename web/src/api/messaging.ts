import { ApiError } from "./auth";

export interface ChatMessage {
  id: string;
  who: string;
  text: string;
  createdAt: string;
}

export interface DmMessage {
  id: string;
  fromUserId: string;
  text: string;
  createdAt: string;
}

export interface Peer {
  id: string;
  prenom: string;
}

export interface Conversation {
  peerId: string;
  prenom: string;
  lastText: string;
  lastAt: string;
  unread: number;
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

export function listUsers() {
  return request<{ users: Peer[] }>("/messaging/users").then((r) => r.users);
}

export function listGeneralMessages() {
  return request<{ messages: ChatMessage[] }>("/messaging/general/messages").then((r) => r.messages);
}

export function listConversations() {
  return request<{ conversations: Conversation[] }>("/messaging/dm/conversations").then((r) => r.conversations);
}

export function listDmMessages(peerId: string) {
  return request<{ messages: DmMessage[] }>(`/messaging/dm/${peerId}/messages`).then((r) => r.messages);
}

function socketOrigin(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export function generalChatSocketUrl(): string {
  return `${socketOrigin()}/api/messaging/general/chat`;
}

export function dmSocketUrl(peerId: string): string {
  return `${socketOrigin()}/api/messaging/dm/${peerId}/chat`;
}
