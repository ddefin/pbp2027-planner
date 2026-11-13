import { ApiError } from "./auth";

export interface AdminLookup {
  exists: boolean;
  account: {
    prenom: string;
    email: string;
    isAdmin: boolean;
    createdAt: string;
    locked: boolean;
    lockedUntil: string | null;
    failedLoginAttempts: number;
    activeResetLinks: number;
    lastSeenAt: string | null;
  } | null;
  events: { kind: string; detail: string | null; at: string }[];
  mail: { configured: boolean; host: string | null; port: number | null; from: string | null; publicUrl: string | null };
}

export async function lookupAccount(email: string): Promise<AdminLookup> {
  const res = await fetch(`/api/admin/account?email=${encodeURIComponent(email)}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
  return body as AdminLookup;
}
