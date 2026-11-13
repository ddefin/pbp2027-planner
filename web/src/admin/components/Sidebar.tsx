import { NavLink } from "react-router-dom";
import { ArrowLeft, Bike } from "lucide-react";
import { NAV } from "../nav";

export function Sidebar({ collapsed, mobileOpen, onNavigate }: { collapsed: boolean; mobileOpen: boolean; onNavigate: () => void }) {
  return (
    <aside className={`ad-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-open" : ""}`} aria-label="Navigation de l'administration" id="ad-sidebar">
      <div className="ad-brand">
        <span className="ad-brand-logo" aria-hidden="true">
          <Bike size={18} />
        </span>
        <span className="ad-brand-text">
          PBP<span>2027</span> <small>Admin</small>
        </span>
      </div>
      <nav className="ad-nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/admin"} className={({ isActive }) => `ad-nav-item${isActive ? " is-active" : ""}`} title={collapsed ? label : undefined} onClick={onNavigate}>
            <Icon size={18} aria-hidden="true" />
            <span className="ad-nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="ad-sidebar-foot">
        <NavLink to="/" className="ad-nav-item" title={collapsed ? "Retour au site" : undefined}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span className="ad-nav-label">Retour au site</span>
        </NavLink>
      </div>
    </aside>
  );
}
