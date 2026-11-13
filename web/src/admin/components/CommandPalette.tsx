import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Map as MapIcon, Search, UserRound, type LucideIcon } from "lucide-react";
import { NAV } from "../nav";
import { searchAdmin, type SearchResult } from "../api";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  to: string;
  icon: LucideIcon;
}

// Palette de commandes (Ctrl/⌘+K) : aller à une page, retrouver un compte ou un tracé.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setRemote(null);
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    } else if (!open && d.open) d.close();
  }, [open]);

  // Recherche serveur (≥ 2 caractères), avec un léger délai pour ne pas solliciter l'API à chaque frappe.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRemote(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchAdmin(term)
        .then(setRemote)
        .catch(() => setRemote(null))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const pages = NAV.filter((n) => !term || `${n.label} ${n.keywords}`.toLowerCase().includes(term)).map((n) => ({ id: n.to, group: "Pages", label: n.label, to: n.to, icon: n.icon }));
    const users = (remote?.users ?? []).map((u) => ({ id: `u-${u.id}`, group: "Utilisateurs", label: u.prenom, hint: `${u.email}${u.suspended ? " · suspendu" : u.isAdmin ? " · admin" : ""}`, to: `/admin/utilisateurs/${u.id}`, icon: UserRound }));
    const routes = (remote?.pbpRoutes ?? []).map((r) => ({ id: `r-${r.id}`, group: "Tracés PBP", label: r.label, hint: r.kind, to: `/admin/contenus?onglet=traces`, icon: MapIcon }));
    return [...pages, ...users, ...routes];
  }, [q, remote]);

  useEffect(() => setActive(0), [items.length]);

  function go(item: Item | undefined) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  let lastGroup = "";
  return (
    <dialog ref={ref} className="ad-palette" aria-label="Recherche et navigation" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="ad-palette-input">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une page, un compte, un tracé…"
          aria-label="Rechercher"
          role="combobox"
          aria-expanded="true"
          aria-controls="ad-palette-list"
          aria-activedescendant={items[active] ? `ad-opt-${items[active].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(items[active]);
            }
          }}
        />
        <kbd>Échap</kbd>
      </div>
      <ul className="ad-palette-list" id="ad-palette-list" role="listbox">
        {items.length === 0 && <li className="ad-palette-empty">{loading ? "Recherche…" : q.trim().length < 2 ? "Tape au moins 2 caractères." : "Aucun résultat."}</li>}
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          const Icon = it.icon;
          return (
            <li key={it.id} role="presentation">
              {head && <div className="ad-palette-group">{head}</div>}
              <div id={`ad-opt-${it.id}`} role="option" aria-selected={i === active} className={`ad-palette-item${i === active ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(it)}>
                <Icon size={16} />
                <span className="ad-palette-label">{it.label}</span>
                {it.hint && <span className="ad-palette-hint">{it.hint}</span>}
                {i === active && <CornerDownLeft size={14} aria-hidden="true" className="ad-palette-enter" />}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
