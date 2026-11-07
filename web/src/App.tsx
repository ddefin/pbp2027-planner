import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SecurityPage } from "./pages/SecurityPage";

function ProtectedLayout({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const navigate = useNavigate();

  if (status === "loading") return null;
  if (status === "anonymous") return <Navigate to="/login" replace />;

  return (
    <div>
      <div className="topbar">
        <strong>
          PBP<span style={{ color: "var(--accent)" }}>2027</span>
        </strong>
        <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link to="/">Tableau de bord</Link>
          <Link to="/securite">Sécurité</Link>
          <button
            className="ghost"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Déconnexion
          </button>
        </nav>
      </div>
      {children}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/inscription" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedLayout>
              <DashboardPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/securite"
          element={
            <ProtectedLayout>
              <SecurityPage />
            </ProtectedLayout>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
