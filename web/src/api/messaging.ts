import { ApiError, type AvatarData } from "./auth";

export type MessageKind = "text" | "location" | "file";

export interface ChatMessage {
  id: string;
  who: string;
  avatar?: AvatarData;
  fromUserId: string;
  text: string;
  kind: MessageKind;
  lat: number | null;
  lon: number | null;
  fileName: string | null;
  fileMimeType: string | null;
  hasFile: boolean;
  createdAt: string;
}

export interface DmMessage {
  id: string;
  fromUserId: string;
  text: string;
  kind: MessageKind;
  lat: number | null;
  lon: number | null;
  fileName: string | null;
  fileMimeType: string | null;
  hasFile: boolean;
  createdAt: string;
}

export interface Peer {
  id: string;
  prenom: string;
  avatar?: AvatarData;
}

export interface Conversation {
  peerId: string;
  prenom: string;
  avatar?: AvatarData;
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

export function deleteGeneralMessage(id: string) {
  return request<void>(`/messaging/general/messages/${id}`, { method: "DELETE" });
}

export function sendGeneralLocation(lat: number, lon: number) {
  return request<{ message: ChatMessage }>("/messaging/general/location", {
    method: "POST",
    body: JSON.stringify({ lat, lon }),
  }).then((r) => r.message);
}

export async function uploadGeneralFile(file: File): Promise<ChatMessage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/messaging/general/files", { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return (body as { message: ChatMessage }).message;
}

export function generalFileUrl(messageId: string): string {
  return `/api/messaging/general/files/${messageId}`;
}

export function listConversations() {
  return request<{ conversations: Conversation[] }>("/messaging/dm/conversations").then((r) => r.conversations);
}

export function listDmMessages(peerId: string) {
  return request<{ messages: DmMessage[] }>(`/messaging/dm/${peerId}/messages`).then((r) => r.messages);
}

export function deleteDmMessage(peerId: string, id: string) {
  return request<void>(`/messaging/dm/${peerId}/messages/${id}`, { method: "DELETE" });
}

export function sendDmLocation(peerId: string, lat: number, lon: number) {
  return request<{ message: DmMessage }>(`/messaging/dm/${peerId}/location`, {
    method: "POST",
    body: JSON.stringify({ lat, lon }),
  }).then((r) => r.message);
}

export async function uploadDmFile(peerId: string, file: File): Promise<DmMessage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/messaging/dm/${peerId}/files`, { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return (body as { message: DmMessage }).message;
}

export function dmFileUrl(peerId: string, messageId: string): string {
  return `/api/messaging/dm/${peerId}/files/${messageId}`;
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
