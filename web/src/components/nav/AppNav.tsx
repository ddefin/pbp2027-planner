import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { NotificationBell } from "../NotificationBell";
import { Dropdown } from "./Dropdown";
import { MobileDrawer } from "./MobileDrawer";
import { ADMIN_LINKS, isActive, MAIN_LINKS, MORE_LINKS } from "./navLinks";
import { UserMenu, useSignOut } from "./UserMenu";

// Barre du haut. Bureau (≥ 1200 px) : liens fréquents, « Plus », « Administration »
// (administrateur seulement), cloche, compte. Dessous : cloche + bouton « Menu » qui
// ouvre le panneau. La bascule se fait en CSS seul (pas de calcul de largeur en JS).
export function AppNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => setOpen(false), [pathname]);

  if (!user) return null;
  const moreActive = MORE_LINKS.some((l) => isActive(pathname, l.to));
  const adminActive = ADMIN_LINKS.some((l) => isActive(pathname, l.to));

  return (
    <header className="topbar app-nav">
      <div className="app-nav-inner">
        <Link to="/" className="brand-link app-nav-brand" aria-label="PBP 2027, tableau de bord">
          <img src="/favicon.svg" alt="" width={30} height={30} className="brand-logo" />
          <span>
            PBP<span style={{ color: "var(--accent)" }}>2027</span>
          </span>
        </Link>

        <nav className="app-nav-main" aria-label="Navigation principale">
          {MAIN_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="app-nav-link" aria-current={isActive(pathname, l.to) ? "page" : undefined}>
              <l.icon size={17} aria-hidden="true" />
              <span>{l.label}</span>
            </Link>
          ))}
          <Dropdown className="app-nav-more" active={moreActive} trigger={<span>Plus</span>}>
            {(done) =>
              MORE_LINKS.map((l) => (
                <Link key={l.to} to={l.to} role="menuitem" className="app-dd-item" aria-current={isActive(pathname, l.to) ? "page" : undefined} onClick={done}>
                  <l.icon size={17} aria-hidden="true" /> {l.label}
                </Link>
              ))
            }
          </Dropdown>
          {user.isAdmin && (
            <Dropdown
              className="app-nav-admin"
              active={adminActive}
              trigger={
                <>
                  <ShieldCheck size={17} aria-hidden="true" />
                  <span>Administration</span>
                </>
              }
            >
              {(done) =>
                ADMIN_LINKS.map((l) => (
                  <Link key={l.to} to={l.to} role="menuitem" className="app-dd-item" aria-current={isActive(pathname, l.to) ? "page" : undefined} onClick={done}>
                    <l.icon size={17} aria-hidden="true" /> {l.label}
                  </Link>
                ))
              }
            </Dropdown>
          )}
        </nav>

        <div className="app-nav-end">
          <NotificationBell />
          <div className="app-nav-desktop-only">
            <UserMenu />
          </div>
          <button
            ref={menuBtn}
            type="button"
            className="app-nav-menu-btn"
            aria-expanded={open}
            aria-controls="app-drawer-panel"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} aria-hidden="true" /> <span>Menu</span>
          </button>
        </div>
      </div>
      <MobileDrawer open={open} onClose={close} user={user} pathname={pathname} onSignOut={() => void signOut()} returnFocusTo={menuBtn} />
    </header>
  );
}
