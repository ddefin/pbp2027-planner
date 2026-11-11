import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const RELOAD_FLAG = "pbp.notfound.reloaded";

// Adresse inconnue de CETTE version de l'app. Cause la plus fréquente : une version
// plus ancienne gardée en cache par le mode hors-ligne (service worker), qui ne
// connaît pas encore une page ajoutée depuis — typiquement un lien de suivi /r/…
// ouvert sur un téléphone où l'app avait déjà été utilisée. On force donc une
// vérification de mise à jour puis un rechargement, une seule fois par adresse
// (drapeau en sessionStorage) pour ne jamais boucler sur une vraie page inexistante.
export function NotFoundPage() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const key = `${RELOAD_FLAG}:${window.location.pathname}`;
    let alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(key) === "1";
      sessionStorage.setItem(key, "1");
    } catch {
      alreadyTried = true; // sans stockage, pas de rechargement automatique (risque de boucle)
    }
    if (alreadyTried || !("serviceWorker" in navigator)) {
      setChecking(false);
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        await reg?.update();
        await reg?.unregister();
      })
      .catch(() => undefined)
      .finally(() => window.location.reload());
  }, []);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {checking ? (
          <>
            <h1>Mise à jour…</h1>
            <p className="hint">Chargement de la dernière version de l'application.</p>
          </>
        ) : (
          <>
            <h1>Page introuvable</h1>
            <p className="hint">Cette adresse n'existe pas (ou plus). Si c'est un lien de suivi, il a peut-être été désactivé par son auteur.</p>
            <Link to="/">Retour à l'accueil</Link>
          </>
        )}
      </div>
    </div>
  );
}
