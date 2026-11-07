import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="wrap">
      <section className="panel">
        <h2>Carnet de route</h2>
        <p className="hint">
          Connecté comme <strong>{user?.email}</strong>. Le tableau de bord complet (compte à rebours, suivi des BRM,
          coordination des sorties) reste à brancher sur ce socle d'authentification.
        </p>
      </section>
    </div>
  );
}
