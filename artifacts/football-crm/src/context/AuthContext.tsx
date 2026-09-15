import { createContext, useContext, useState } from "react";

type Role = "admin" | "player" | null;

interface AuthContextValue {
  role: Role;
  isAdmin: boolean;
  login: (password: string) => boolean;
  logout: () => void;
}

const ROLE_KEY = "bg-crm-role";

// UI-only gate: these ship in the client bundle, so they're not a real secret —
// they just distinguish who sees edit controls, not who the database trusts.
const ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD as string) || "admin";
const PLAYER_PASSWORD = (import.meta.env.VITE_PLAYER_PASSWORD as string) || "player";

const AuthContext = createContext<AuthContextValue>({
  role: null,
  isAdmin: false,
  login: () => false,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(() => {
    try {
      const saved = localStorage.getItem(ROLE_KEY);
      if (saved === "admin" || saved === "player") return saved;
    } catch {}
    return null;
  });

  const login = (password: string) => {
    let next: Role = null;
    if (password === ADMIN_PASSWORD) next = "admin";
    else if (password === PLAYER_PASSWORD) next = "player";

    if (!next) return false;

    setRole(next);
    try { localStorage.setItem(ROLE_KEY, next); } catch {}
    return true;
  };

  const logout = () => {
    setRole(null);
    try { localStorage.removeItem(ROLE_KEY); } catch {}
  };

  return (
    <AuthContext.Provider value={{ role, isAdmin: role === "admin", login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
