// Formats communs de l'espace admin (français, chiffres tabulaires).
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtNum = (n: number) => n.toLocaleString("fr-FR");

export function fmtAgo(iso: string | null): string {
  if (!iso) return "jamais";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 1440) return `il y a ${Math.floor(min / 60)} h`;
  const d = Math.floor(min / 1440);
  return d < 30 ? `il y a ${d} j` : fmtDate(iso);
}

// Libellés des actions du journal d'audit et des événements de compte.
export const ACTION_LABEL: Record<string, string> = {
  "user.suspend": "a suspendu",
  "user.unsuspend": "a réactivé",
  "user.promote": "a nommé administrateur",
  "user.demote": "a retiré le rôle administrateur de",
  "user.delete": "a supprimé (anonymisé)",
  "content.delete": "a supprimé le contenu",
};

export const EVENT_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "error" | "info" }> = {
  login_ok: { label: "Connexion réussie", tone: "ok" },
  login_locked: { label: "Connexion refusée : compte verrouillé (trop d'erreurs)", tone: "error" },
  login_suspended: { label: "Connexion refusée : compte suspendu", tone: "error" },
  reset_requested: { label: "Demande de réinitialisation du mot de passe", tone: "info" },
  reset_no_account: { label: "Demande pour une adresse sans compte (rien n'est envoyé)", tone: "warn" },
  reset_suspended: { label: "Demande ignorée : compte suspendu", tone: "warn" },
  mail_sent: { label: "E-mail de réinitialisation remis au serveur mail", tone: "ok" },
  mail_failed: { label: "E-mail NON envoyé", tone: "error" },
  reset_ok: { label: "Mot de passe réinitialisé", tone: "ok" },
  reset_token_invalid: { label: "Lien de réinitialisation refusé (expiré ou déjà utilisé)", tone: "warn" },
};
