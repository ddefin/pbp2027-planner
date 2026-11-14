import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, User } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme, type ThemeChoice } from "../../hooks/useTheme";
import { Breadcrumbs } from "./Breadcrumbs";
import { Avatar } from "../../components/Avatar";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
  const label = { system: "Thème : système", light: "Thème : clair", dark: "Thème : sombre" }[theme];
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <button type="button" className="ad-icon-btn" onClick={() => setTheme(next[theme])} aria-label={`${label} (cliquer pour changer)`} title={label}>
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="ad-profile" ref={ref}>
      <button type="button" className="ad-avatar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label="Menu du profil">
        <Avatar name={user?.prenom ?? "?"} avatar={user?.avatar} size={32} />
      </button>
      {open && (
        <div className="ad-menu" role="menu">
          <div className="ad-menu-head">
            <strong>{user?.prenom}</strong>
            <span>{user?.email}</span>
          </div>
          <Link role="menuitem" to="/profil" className="ad-menu-item" onClick={() => setOpen(false)}>
            <User size={16} aria-hidden="true" /> Mon profil
          </Link>
          <Link role="menuitem" to="/" className="ad-menu-item" onClick={() => setOpen(false)}>
            <Monitor size={16} aria-hidden="true" /> Retour au site
          </Link>
          <button role="menuitem" type="button" className="ad-menu-item" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden="true" /> Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ collapsed, onToggleCollapse, onOpenMobile, onOpenSearch }: { collapsed: boolean; onToggleCollapse: () => void; onOpenMobile: () => void; onOpenSearch: () => void }) {
  return (
    <header className="ad-topbar">
      <button type="button" className="ad-icon-btn ad-only-mobile" onClick={onOpenMobile} aria-label="Ouvrir la navigation" aria-controls="ad-sidebar">
        <Menu size={20} aria-hidden="true" />
      </button>
      <button type="button" className="ad-icon-btn ad-only-desktop" onClick={onToggleCollapse} aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"} aria-controls="ad-sidebar" aria-expanded={!collapsed}>
        {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
      <Breadcrumbs />
      <div className="ad-topbar-right">
        <button type="button" className="ad-search-btn" onClick={onOpenSearch} aria-label="Rechercher (raccourci Ctrl+K)">
          <Search size={16} aria-hidden="true" />
          <span className="ad-search-label">Rechercher…</span>
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
