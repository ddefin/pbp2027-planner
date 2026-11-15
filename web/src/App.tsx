import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { AppNav } from "./components/nav/AppNav";
import { pageTitle } from "./components/nav/navLinks";
import { NotFoundPage } from "./pages/NotFoundPage";

// Page la plus lourde de l'app (carte, profil, simulation, météo) : chargée seulement
// quand on l'ouvre, pour que le reste de l'app démarre aussi vite qu'avant sur mobile.
const PbpRoutePage = lazy(() => import("./pages/PbpRoutePage").then((m) => ({ default: m.PbpRoutePage })));
const RoadbooksPage = lazy(() => import("./pages/RoadbooksPage").then((m) => ({ default: m.RoadbooksPage })));
const RoadbookPage = lazy(() => import("./pages/RoadbookPage").then((m) => ({ default: m.RoadbookPage })));
const AdminApp = lazy(() => import("./admin/AdminApp"));
const GroupMapPage = lazy(() => import("./pages/GroupMapPage").then((m) => ({ default: m.GroupMapPage })));
const SharedRoadbookPage = lazy(() => import("./pages/SharedRoadbookPage").then((m) => ({ default: m.SharedRoadbookPage })));

const pageFallback = <p className="hint" style={{ padding: 24 }}>Chargement…</p>;

function ProtectedLayout({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const title = pageTitle(location.pathname);

  // Lecteurs d'écran (VoiceOver) : dans une application d'une seule page, rien n'est annoncé
  // quand on change de page. On met à jour le titre de l'onglet et on place le focus sur le
  // titre de la nouvelle page, que VoiceOver lit aussitôt. Pas au premier affichage (le
  // navigateur annonce déjà la page chargée).
  useEffect(() => {
    document.title = `${title} — PBP 2027`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    h1Ref.current?.focus({ preventScroll: false });
  }, [location.pathname, title]);

  // Une nouvelle version attend (voir main.tsx) : on l'applique au changement de page,
  // moment où un rechargement ne fait rien perdre.
  useEffect(() => {
    if (window.__pbpUpdateReady) window.location.reload();
  }, [location.pathname]);

  if (status === "loading") return null;
  // On garde la page demandée (ex. retour de Strava sur /profil#strava) pour y revenir après la connexion.
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  if (adminOnly && !user?.isAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <AppNav />
      <main id="contenu" tabIndex={-1}>
        <h1 ref={h1Ref} tabIndex={-1} className="sr-only">
          {title}
        </h1>
        {children}
      </main>
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
          path="/carte-groupe"
          element={
            <ProtectedLayout>
              <Suspense fallback={pageFallback}>
                <GroupMapPage />
              </Suspense>
            </ProtectedLayout>
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
          path="/admin/*"
          element={
            <Suspense fallback={pageFallback}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="/administration" element={<Navigate to="/admin" replace />} />
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
