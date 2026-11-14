import { Plus } from "lucide-react";
import { CATALOG_STATUS_LABEL, CATALOG_STATUS_OPTIONS } from "../../lib/brmMeta";

// Mon statut sur un BRM du calendrier : « Choisir » en un geste (= Prévu), puis une
// pastille colorée qui reste un vrai <select> (clavier, sélecteur natif sur téléphone).
export function StatusPicker({
  status,
  label,
  onChoose,
  onClear,
}: {
  status: string | null;
  label: string; // ex. « BRM 300 Rennes, 12 avril »
  onChoose: (status: string) => void;
  onClear: () => void;
}) {
  if (!status) {
    return (
      <button type="button" className="gb-choose" onClick={() => onChoose("prevu")} aria-label={`Choisir : ${label}`}>
        <Plus size={15} aria-hidden="true" /> Choisir
      </button>
    );
  }
  return (
    <select
      className={`gb-status is-${status}`}
      value={status}
      aria-label={`Mon statut : ${label}`}
      onChange={(e) => (e.target.value === "" ? onClear() : onChoose(e.target.value))}
    >
      {CATALOG_STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {CATALOG_STATUS_LABEL[s]}
        </option>
      ))}
      <option value="">Retirer ce BRM</option>
    </select>
  );
}
