import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, logout as apiLogout, type SessionInfo } from "../api/auth";

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
      setUser(session);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
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
