import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MessagesPage } from "./pages/MessagesPage";
import { CalendrierPage } from "./pages/CalendrierPage";
import { NewsPage } from "./pages/NewsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { WebhooksPage } from "./pages/WebhooksPage";
import { ParcoursPage } from "./pages/ParcoursPage";
import { NotificationBell } from "./components/NotificationBell";
import { NotFoundPage } from "./pages/NotFoundPage";

// Page la plus lourde de l'app (carte, profil, simulation, météo) : chargée seulement
// quand on l'ouvre, pour que le reste de l'app démarre aussi vite qu'avant sur mobile.
const PbpRoutePage = lazy(() => import("./pages/PbpRoutePage").then((m) => ({ default: m.PbpRoutePage })));
const RoadbooksPage = lazy(() => import("./pages/RoadbooksPage").then((m) => ({ default: m.RoadbooksPage })));
const RoadbookPage = lazy(() => import("./pages/RoadbookPage").then((m) => ({ default: m.RoadbookPage })));
const SharedRoadbookPage = lazy(() => import("./pages/SharedRoadbookPage").then((m) => ({ default: m.SharedRoadbookPage })));

const pageFallback = <p className="hint" style={{ padding: 24 }}>Chargement…</p>;

function ProtectedLayout({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === "loading") return null;
  // On garde la page demandée (ex. retour de Strava sur /profil#strava) pour y revenir après la connexion.
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  if (adminOnly && !user?.isAdmin) return <Navigate to="/" replace />;

  const links = [
    { to: "/", label: "Tableau de bord" },
    { to: "/parcours-pbp", label: "Parcours PBP" },
    { to: "/calendrier", label: "Calendrier BRM" },
    { to: "/roadbooks", label: "Roadbook" },
    { to: "/actualites", label: "Actualités" },
    { to: "/messagerie", label: "Messagerie" },
    { to: "/profil", label: "Mon profil" },
    ...(user?.isAdmin ? [{ to: "/webhooks", label: "Webhooks" }] : []),
  ];

  return (
    <div>
      <div className="topbar">
        <strong className="brand-link">
          <img src="/favicon.svg" alt="" width={28} height={28} className="brand-logo" />
          <span>
            PBP<span style={{ color: "var(--accent)" }}>2027</span>
          </span>
        </strong>
        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <nav className={menuOpen ? "nav-open" : undefined}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={location.pathname === l.to || (l.to !== "/" && location.pathname.startsWith(`${l.to}/`)) ? "active" : undefined} onClick={() => setMenuOpen(false)}>
              {l.label}
            </Link>
          ))}
          {user && <NotificationBell />}
          {user && <span className="hint nav-greeting">Bonjour, {user.prenom}</span>}
          <button
            className="ghost"
            onClick={async () => {
              setMenuOpen(false);
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
        <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            <ProtectedLayout>
              <DashboardPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/calendrier"
          element={
            <ProtectedLayout>
              <CalendrierPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/roadbooks"
          element={
            <ProtectedLayout>
              <Suspense fallback={pageFallback}>
                <RoadbooksPage />
              </Suspense>
            </ProtectedLayout>
          }
        />
        <Route
          path="/roadbooks/:id"
          element={
            <ProtectedLayout>
              <Suspense fallback={pageFallback}>
                <RoadbookPage />
              </Suspense>
            </ProtectedLayout>
          }
        />
        {/* Lien de suivi public : volontairement HORS ProtectedLayout (pas de compte). */}
        <Route
          path="/r/:token"
          element={
            <Suspense fallback={pageFallback}>
              <SharedRoadbookPage />
            </Suspense>
          }
        />
        <Route
          path="/parcours-pbp"
          element={
            <ProtectedLayout>
              <Suspense fallback={<p className="hint" style={{ padding: 24 }}>Chargement de la carte…</p>}>
                <PbpRoutePage />
              </Suspense>
            </ProtectedLayout>
          }
        />
        <Route
          path="/actualites"
          element={
            <ProtectedLayout>
              <NewsPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/messagerie"
          element={
            <ProtectedLayout>
              <MessagesPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/profil"
          element={
            <ProtectedLayout>
              <ProfilePage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/webhooks"
          element={
            <ProtectedLayout adminOnly>
              <WebhooksPage />
            </ProtectedLayout>
          }
        />
        <Route
          path="/brm/:brmEventId/parcours"
          element={
            <ProtectedLayout>
              <ParcoursPage />
            </ProtectedLayout>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
