import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { LogOut, X } from "lucide-react";
import type { SessionInfo } from "../../api/auth";
import { Avatar } from "../Avatar";
import { ADMIN_LINKS, isActive, MAIN_LINKS, MORE_LINKS, ACCOUNT_LINKS, type NavItem } from "./navLinks";
import { ThemeChoice } from "./ThemeChoice";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Panneau de navigation (téléphone, tablette) : sections, compte en tête, déconnexion
// fixée en bas (jamais hors de l'écran). Échap, fond et navigation le ferment ; le
// focus reste dans le panneau tant qu'il est ouvert ; le défilement de la page est bloqué.
export function MobileDrawer({
  open,
  onClose,
  user,
  pathname,
  onSignOut,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionInfo;
  pathname: string;
  onSignOut: () => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("app-nav-lock");
    closeRef.current?.focus();
    const returnTo = returnFocusTo.current;
    return () => {
      root.classList.remove("app-nav-lock");
      returnTo?.focus();
    };
  }, [open, returnFocusTo]);

  // Passage en affichage « bureau » pendant que le panneau est ouvert (rotation, redimensionnement).
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1200px)");
    const h = () => mq.matches && onClose();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [open, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const link = (l: NavItem) => (
    <li key={l.to}>
      <Link to={l.to} className="app-drawer-link" aria-current={isActive(pathname, l.to) ? "page" : undefined} onClick={onClose}>
        <l.icon size={20} aria-hidden="true" /> {l.label}
      </Link>
    </li>
  );

  return (
    <div className={`app-drawer${open ? " is-open" : ""}`} aria-hidden={!open} onKeyDown={onKeyDown}>
      <div className="app-drawer-backdrop" onClick={onClose} />
      <aside ref={panelRef} id="app-drawer-panel" className="app-drawer-panel" role="dialog" aria-modal="true" aria-label="Menu de navigation" {...(open ? {} : { inert: "" })}>
        <div className="app-drawer-top">
          <div className="app-drawer-me">
            <Avatar name={user.prenom} avatar={user.avatar} size={44} />
            <div>
              <strong>{user.prenom}</strong>
              <span>{user.isAdmin ? "Administrateur" : "Randonneur"}</span>
            </div>
          </div>
          <button ref={closeRef} type="button" className="app-drawer-close" onClick={onClose} aria-label="Fermer le menu">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="app-drawer-scroll">
          <nav aria-label="Navigation principale">
            <p className="app-drawer-cap">Navigation</p>
            <ul>{[...MAIN_LINKS, ...MORE_LINKS].map(link)}</ul>
            <p className="app-drawer-cap">Mon compte</p>
            <ul>{ACCOUNT_LINKS.map(link)}</ul>
            {user.isAdmin && (
              <>
                <p className="app-drawer-cap">Administration</p>
                <ul>{ADMIN_LINKS.map(link)}</ul>
              </>
            )}
          </nav>
          <p className="app-drawer-cap">Thème</p>
          <ThemeChoice />
        </div>
        <div className="app-drawer-foot">
          <button type="button" className="app-drawer-logout" onClick={onSignOut}>
            <LogOut size={20} aria-hidden="true" /> Déconnexion
          </button>
        </div>
      </aside>
    </div>
  );
}
