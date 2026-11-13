import { FolderOpen, LayoutDashboard, ScrollText, Settings, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
}

export const NAV: NavItem[] = [
  { to: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, keywords: "accueil tableau de bord kpi statistiques" },
  { to: "/admin/utilisateurs", label: "Utilisateurs", icon: Users, keywords: "comptes membres randonneurs suspendre supprimer" },
  { to: "/admin/contenus", label: "Contenus", icon: FolderOpen, keywords: "messages tracés gpx brm modération" },
  { to: "/admin/journaux", label: "Journaux d'audit", icon: ScrollText, keywords: "historique audit événements connexions" },
  { to: "/admin/parametres", label: "Paramètres", icon: Settings, keywords: "configuration mail telegram strava webhooks" },
];

// Libellés du fil d'Ariane, par segment d'URL.
export const SEGMENT_LABEL: Record<string, string> = {
  utilisateurs: "Utilisateurs",
  contenus: "Contenus",
  journaux: "Journaux d'audit",
  parametres: "Paramètres",
};
