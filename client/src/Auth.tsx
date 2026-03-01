import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, parseJson } from "./api";

export interface User {
  id: number;
  email: string;
  displayName: string | null;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Fetch with credentials; on 401 calls logout and throws. */
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, []);

  const apiFetchWithAuth = useCallback(
    async (url: string, init?: RequestInit) => {
      return apiFetch(url, init, logout);
    },
    [logout]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (cancelled) return;
        if (res.status === 401 || !res.ok) {
          setUser(null);
          setLoading(false);
          return;
        }
        const data = await parseJson<{ id: number; email: string; displayName?: string | null }>(res);
        if (!cancelled && data) {
          setUser({
            id: data.id,
            email: data.email,
            displayName: data.displayName ?? null,
          });
        } else if (!cancelled) {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await parseJson<{ id: number; email: string; displayName?: string | null }>(res);
    if (!res.ok) throw new Error((data as { error?: string })?.error ?? "Login failed");
    if (data) {
      setUser({
        id: data.id,
        email: data.email,
        displayName: data.displayName ?? null,
      });
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName: displayName ?? null }),
      });
      const data = await parseJson<{ id: number; email: string; displayName?: string | null; error?: string; detail?: string }>(res);
      if (!res.ok) {
        const msg = data && "error" in data ? data.error : "Registration failed";
        const detail = data && "detail" in data ? data.detail : undefined;
        throw new Error(detail ? `${msg}: ${detail}` : msg);
      }
      if (data) {
        setUser({
          id: data.id,
          email: data.email,
          displayName: data.displayName ?? null,
        });
      }
    },
    []
  );

  const value: AuthContextValue = {
    user,
    loading,
    login,
    register,
    logout,
    apiFetch: apiFetchWithAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
