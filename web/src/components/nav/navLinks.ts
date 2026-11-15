import { BookOpen, CalendarDays, Home, MapPinned, MessageCircle, Newspaper, Route, ShieldCheck, UserRound, Webhook, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Source unique des liens : la barre (bureau) et le panneau (mobile) en dérivent, ils
// ne peuvent donc pas diverger. Les liens d'administration ne sont que du confort :
// la vraie garde est côté serveur (`adminGuard`) et dans le routage.
export const MAIN_LINKS: NavItem[] = [
  { to: "/", label: "Tableau de bord", icon: Home },
  { to: "/parcours-pbp", label: "Parcours PBP", icon: Route },
  { to: "/calendrier", label: "Calendrier BRM", icon: CalendarDays },
  { to: "/roadbooks", label: "Roadbook", icon: BookOpen },
  { to: "/carte-groupe", label: "Carte du groupe", icon: MapPinned },
  { to: "/messagerie", label: "Messagerie", icon: MessageCircle },
];

export const MORE_LINKS: NavItem[] = [{ to: "/actualites", label: "Actualités", icon: Newspaper }];

export const ACCOUNT_LINKS: NavItem[] = [{ to: "/profil", label: "Mon profil", icon: UserRound }];

export const ADMIN_LINKS: NavItem[] = [
  { to: "/admin", label: "Console d'administration", icon: ShieldCheck },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
];

export function isActive(pathname: string, to: string): boolean {
  return pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
}

// Titre de chaque page (onglet du navigateur et titre lu par VoiceOver au changement de page).
export function pageTitle(pathname: string): string {
  const all = [...MAIN_LINKS, ...MORE_LINKS, ...ACCOUNT_LINKS, ...ADMIN_LINKS];
  const exact = all.find((l) => l.to === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith("/roadbooks/")) return "Roadbook";
  const prefix = all.filter((l) => l.to !== "/" && pathname.startsWith(`${l.to}/`)).sort((a, b) => b.to.length - a.to.length)[0];
  return prefix?.label ?? "PBP 2027";
}
