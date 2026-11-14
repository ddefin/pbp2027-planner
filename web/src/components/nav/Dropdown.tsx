import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

// Menu déroulant accessible : clic ou clavier pour ouvrir, Échap (focus rendu au
// bouton), clic à l'extérieur, changement de page, flèches haut/bas, Début/Fin.
export function Dropdown({
  trigger,
  label,
  className,
  active,
  align = "start",
  children,
}: {
  trigger: ReactNode;
  label?: string; // nom accessible quand le bouton n'a pas de texte
  className?: string;
  active?: boolean;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { pathname } = useLocation();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    const wrap = wrapRef.current;
    wrap?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      wrap?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    if (!open) {
      if (e.target === btnRef.current && e.key !== "Home" && e.key !== "End") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => (e.key === "ArrowUp" ? items().at(-1) : items()[0])?.focus());
      }
      return;
    }
    const list = items();
    if (list.length === 0) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  }

  return (
    <div className={`app-dd${className ? ` ${className}` : ""}`} ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={btnRef}
        type="button"
        className={`app-dd-btn${active ? " is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
        <ChevronDown size={14} aria-hidden="true" className="app-dd-chev" />
      </button>
      {open && (
        <div id={id} className={`app-dd-menu is-${align}`} role="menu" ref={menuRef}>
          {children(() => close())}
        </div>
      )}
    </div>
  );
}
