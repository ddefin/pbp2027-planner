import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type DisclosureTone = "ok" | "warn" | "error" | "muted";

const STORAGE_PREFIX = "pbp.disclosure.";

function readStored(key: string | undefined): boolean | null {
  if (!key) return null;
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

// Section dépliable : le titre et un RÉSUMÉ D'ÉTAT restent visibles quand elle est
// fermée (« ✓ Lien actif », « ⚠ Publication échouée »…), pour qu'on sache où en sont
// ses réglages sans tout ouvrir.
// - `defaultOpen` : ouverture initiale. S'il PASSE à vrai en cours de route (ex. une
//   publication qui vient d'échouer), la section s'ouvre d'elle-même tant que la personne
//   n'y a pas touché. Jamais l'inverse : une section ne se referme pas toute seule (ce
//   serait sous les doigts de quelqu'un qui vient de remplir le champ qu'elle contient).
// - `storageKey` : mémorise le choix de la personne (ouvert/fermé) sur cet appareil ; il
//   l'emporte alors sur `defaultOpen`.
// Le contenu reste monté même fermé (attribut hidden) : un champ à moitié rempli ou un
// état chargé n'est pas perdu en refermant.
export function Disclosure({
  title,
  summary,
  tone = "muted",
  defaultOpen = false,
  storageKey,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  tone?: DisclosureTone;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  const touched = useRef(readStored(storageKey) !== null);
  const [open, setOpen] = useState<boolean>(() => readStored(storageKey) ?? defaultOpen);
  const bodyId = useId();

  useEffect(() => {
    if (!touched.current && defaultOpen) setOpen(true);
  }, [defaultOpen]);

  function toggle() {
    const next = !open;
    touched.current = true;
    setOpen(next);
    if (storageKey) {
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
      } catch {
        // stockage indisponible : le choix n'est simplement pas mémorisé
      }
    }
  }

  return (
    <div className={`disc${open ? " is-open" : ""}`}>
      <button type="button" className="disc-head" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        <span className="disc-text">
          <span className="disc-title">{title}</span>
          {!open && summary && <span className={`disc-summary disc-${tone}`}>{summary}</span>}
        </span>
        <span className={`disc-caret${open ? " open" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      <div id={bodyId} className="disc-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
