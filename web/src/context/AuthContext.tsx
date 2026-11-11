import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, getSession, logout as apiLogout, type SessionInfo } from "../api/auth";

const USER_CACHE = "pbp.sessionUser";
function cachedUser(): SessionInfo | null {
  try {
    return JSON.parse(localStorage.getItem(USER_CACHE) ?? "null");
  } catch {
    return null;
  }
}
function cacheUser(u: SessionInfo | null) {
  try {
    if (u) localStorage.setItem(USER_CACHE, JSON.stringify(u));
    else localStorage.removeItem(USER_CACHE);
  } catch {
    /* ignore */
  }
}

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  user: SessionInfo | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      cacheUser(session);
      setUser(session);
      setStatus("authenticated");
    } catch (err) {
      // Pas de réseau (en montagne) : on garde la dernière session connue pour pouvoir
      // consulter le roadbook et pointer hors ligne. Seule une vraie réponse 401 déconnecte.
      const cached = !(err instanceof ApiError) ? cachedUser() : null;
      if (cached) {
        setUser(cached);
        setStatus("authenticated");
      } else {
        cacheUser(null);
        setUser(null);
        setStatus("anonymous");
      }
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    cacheUser(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ status, user, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return ctx;
}
