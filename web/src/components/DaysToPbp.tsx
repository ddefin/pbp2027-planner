import { PBP_DATE, daysUntil } from "../lib/brmMeta";

// Compte à rebours volontairement discret, à côté du logo « PBP2027 » des pages de
// connexion : le nombre de jours seulement, sans animation. Disparaît après le départ.
export function DaysToPbp() {
  const iso = `${PBP_DATE.getFullYear()}-${String(PBP_DATE.getMonth() + 1).padStart(2, "0")}-${String(PBP_DATE.getDate()).padStart(2, "0")}`;
  const days = daysUntil(iso);
  if (days < 0) return null;
  return (
    <span className="brand-countdown" title="Départ du Paris-Brest-Paris le dimanche 22 août 2027">
      <span aria-hidden="true">· {days === 0 ? "Jour J" : `J-${days}`}</span>
      <span className="gb-sr">{days === 0 ? "Départ du Paris-Brest-Paris aujourd'hui" : `Départ du Paris-Brest-Paris dans ${days} jours`}</span>
    </span>
  );
}
