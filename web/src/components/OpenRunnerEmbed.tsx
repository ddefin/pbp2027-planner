import { useState } from "react";
import { extractOpenRunnerRouteId } from "../lib/openrunner";

// Affiche la carte du parcours directement dans la page quand le lien "parcours" du
// calendrier ACP pointe vers OpenRunner — repliée par défaut (chargée uniquement au
// clic) pour ne pas déclencher N requêtes vers openrunner.com à chaque affichage du
// tableau de bord ou du calendrier. OpenRunner n'a pas d'endpoint d'embed dédié connu
// ici : on affiche sa page de détail de parcours (publique, sans authentification)
// dans un iframe — si leur politique d'en-têtes change et bloque l'affichage en
// iframe, le lien "Voir sur OpenRunner ↗" juste à côté reste le filet de secours.
export function OpenRunnerEmbed({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const routeId = extractOpenRunnerRouteId(url);
  if (!routeId) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="ghost" onClick={() => setOpen((v) => !v)} style={{ padding: "4px 10px", fontSize: 11.5 }}>
        {open ? "Masquer la carte" : "Voir la carte du parcours"}
      </button>
      {open && (
        <div style={{ marginTop: 8, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
          <iframe
            src={`https://www.openrunner.com/route-details/${routeId}`}
            title="Carte du parcours OpenRunner"
            width="100%"
            height="360"
            style={{ display: "block", border: "none" }}
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}
