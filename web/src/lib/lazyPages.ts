// Pages chargées à la demande : le premier écran ne télécharge que ce qu'il affiche.
// `preloadPage` lance le téléchargement en avance (survol ou toucher d'un lien du menu),
// pour que le changement de page reste immédiat.
export const pageLoaders = {
  "/calendrier": () => import("../pages/CalendrierPage"),
  "/actualites": () => import("../pages/NewsPage"),
  "/messagerie": () => import("../pages/MessagesPage"),
  "/profil": () => import("../pages/ProfilePage"),
  "/webhooks": () => import("../pages/WebhooksPage"),
  "/parcours-pbp": () => import("../pages/PbpRoutePage"),
  "/roadbooks": () => import("../pages/RoadbooksPage"),
  "/carte-groupe": () => import("../pages/GroupMapPage"),
  "/admin": () => import("../admin/AdminApp"),
} as const;

const done = new Set<string>();
export function preloadPage(path: string): void {
  const load = (pageLoaders as Record<string, (() => Promise<unknown>) | undefined>)[path];
  if (!load || done.has(path)) return;
  done.add(path);
  // Un échec (réseau coupé) n'est pas grave : la page sera chargée au clic.
  load().catch(() => done.delete(path));
}
