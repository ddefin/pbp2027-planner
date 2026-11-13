import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { SEGMENT_LABEL } from "../nav";

// Une page de détail donne son propre libellé (ex. le prénom d'un compte) au fil d'Ariane.
const Ctx = createContext<{ leaf: string | null; setLeaf: (s: string | null) => void }>({ leaf: null, setLeaf: () => undefined });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [leaf, setLeaf] = useState<string | null>(null);
  return <Ctx.Provider value={{ leaf, setLeaf }}>{children}</Ctx.Provider>;
}

export function useBreadcrumbLeaf(label: string | null) {
  const { setLeaf } = useContext(Ctx);
  useEffect(() => {
    setLeaf(label);
    return () => setLeaf(null);
  }, [label, setLeaf]);
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { leaf } = useContext(Ctx);
  const segs = pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
  const crumbs = [{ to: "/admin", label: "Administration" }];
  segs.forEach((s, i) => {
    const to = `/admin/${segs.slice(0, i + 1).join("/")}`;
    const isLast = i === segs.length - 1;
    crumbs.push({ to, label: SEGMENT_LABEL[s] ?? (isLast && leaf ? leaf : "Détail") });
  });
  if (segs.length === 0) crumbs.push({ to: "/admin", label: "Vue d'ensemble" });
  return (
    <nav aria-label="Fil d'Ariane" className="ad-crumbs">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.to}-${i}`} className={i < crumbs.length - 2 ? "ad-crumb-far" : undefined}>
              {last ? (
                <span aria-current="page">{c.label}</span>
              ) : (
                <>
                  <Link to={c.to}>{c.label}</Link>
                  <ChevronRight size={14} aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
