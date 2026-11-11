import { useState } from "react";

// Partage du résumé de situation sur WhatsApp. WhatsApp n'offre pas d'API pour publier
// dans un groupe : on ouvre WhatsApp avec le message déjà rédigé, la personne choisit
// le groupe et envoie. Vrai lien <a> (préparé à l'avance) plutôt qu'un window.open après
// un chargement : Safari iPhone bloque les ouvertures qui ne suivent pas directement un
// appui.
export function WhatsAppShare({ text, at, compact = false }: { text: string | null; at?: string | null; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;

  return (
    <div className="wa-share-box">
      <a className="wa-share" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
        📲 Partager la situation sur WhatsApp
      </a>
      {!compact && (
      <button
        type="button"
        className="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // presse-papiers indisponible : le bouton WhatsApp reste utilisable
          }
        }}
      >
        {copied ? "Copié ✓" : "Copier le texte"}
      </button>
      )}
      {!compact && at && (
        <span className="hint" style={{ margin: 0 }}>
          Situation au pointage de {new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
