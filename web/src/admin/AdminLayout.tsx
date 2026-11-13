import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { CommandPalette } from "./components/CommandPalette";
import { BreadcrumbProvider } from "./components/Breadcrumbs";
import { Toaster } from "./components/Toaster";

const COLLAPSE_KEY = "pbp.admin.sidebar";

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setMobileOpen(false), [pathname]);

  // Raccourci global Ctrl/⌘+K ; Échap ferme la navigation mobile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "open" : "collapsed");
      } catch {
        /* non mémorisé */
      }
      return !c;
    });
  }

  return (
    <Toaster>
      <BreadcrumbProvider>
        <div className={`ad-shell${collapsed ? " is-collapsed" : ""}`}>
          <a href="#ad-main" className="ad-skip">
            Aller au contenu
          </a>
          <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
          {mobileOpen && <div className="ad-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
          <div className="ad-body">
            <Topbar collapsed={collapsed} onToggleCollapse={toggleCollapse} onOpenMobile={() => setMobileOpen(true)} onOpenSearch={() => setPaletteOpen(true)} />
            <main id="ad-main" className="ad-main" tabIndex={-1}>
              <Outlet />
            </main>
          </div>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </div>
      </BreadcrumbProvider>
    </Toaster>
  );
}
