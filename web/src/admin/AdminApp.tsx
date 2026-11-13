import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AdminLayout } from "./AdminLayout";
import "./admin.css";

const OverviewPage = lazy(() => import("./pages/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() => import("./pages/UserDetailPage").then((m) => ({ default: m.UserDetailPage })));
const ContentPage = lazy(() => import("./pages/ContentPage").then((m) => ({ default: m.ContentPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

// Masquer l'espace aux non-admins n'est qu'un confort : c'est le serveur qui refuse chaque
// requête (voir src/lib/adminGuard.ts).
export default function AdminApp() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return null;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route
          index
          element={
            <Suspense fallback={null}>
              <OverviewPage />
            </Suspense>
          }
        />
        <Route path="utilisateurs" element={<Suspense fallback={null}><UsersPage /></Suspense>} />
        <Route path="utilisateurs/:id" element={<Suspense fallback={null}><UserDetailPage /></Suspense>} />
        <Route path="contenus" element={<Suspense fallback={null}><ContentPage /></Suspense>} />
        <Route path="journaux" element={<Suspense fallback={null}><AuditPage /></Suspense>} />
        <Route path="parametres" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
