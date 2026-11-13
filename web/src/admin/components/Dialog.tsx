import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";

// Fenêtre modale accessible (élément <dialog> natif : focus piégé, Échap, fond inerte).
export function Dialog({ open, title, onClose, children, footer, onSubmit, tone = "default" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; onSubmit?: () => void; tone?: "default" | "danger" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`ad-dialog is-${tone}`} onClose={onClose} aria-labelledby="ad-dialog-title">
      <form
        method="dialog"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <header>
          <h2 id="ad-dialog-title">{title}</h2>
          <button type="button" className="ad-icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="ad-dialog-body">{children}</div>
        <footer>{footer}</footer>
      </form>
    </dialog>
  );
}
