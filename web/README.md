# Frontend — login

App React (Vite) branchée sur le service d'authentification du dossier parent (`../src`).

## Pourquoi ce découpage front/back

Tout passe par des chemins **relatifs** sous `/api/...` (jamais une URL absolue vers le backend), et ce préfixe `/api` est délibéré : sans lui, une route backend comme `/messagerie` entrerait directement en collision avec la route client React `/messagerie` — un rechargement complet de page sur cette URL serait intercepté par le proxy et renverrait la réponse JSON de l'API au lieu de l'app.

- **En dev**, `vite.config.ts` proxifie tout `/api/*` vers `http://localhost:3001`, avec `ws: true` (nécessaire car la messagerie utilise une connexion WebSocket, pas du HTTP classique). Le navigateur voit une seule origine (`localhost:5173`), donc pas de CORS et le cookie de session (`SameSite=Strict`) part normalement.
- **En prod**, le reverse proxy (Caddy/Nginx/Traefik) doit faire la même chose : servir les fichiers statiques de `dist/` ET relayer `/api/*` vers le service backend, sous le **même domaine**. C'est ce qui permet de garder `SameSite=Strict` sur le cookie plutôt que de devoir l'affaiblir en `SameSite=None` + CORS pour un vrai cross-origin. `reverse_proxy` de Caddy relaie les upgrades WebSocket automatiquement, sans option particulière ; avec Nginx il faut explicitement `proxy_set_header Upgrade $http_upgrade;` et `proxy_set_header Connection "upgrade";` sur ce bloc.

Exemple Caddy minimal :

```
lameteoducyclo.fr/pbp {
  handle /api/* {
    reverse_proxy localhost:3001
  }
  handle {
    root * /var/www/pbp2027-planner/web/dist
    try_files {path} /index.html
    file_server
  }
}
```

## Démarrer en local

Dans deux terminaux, depuis la racine du repo :

```bash
# terminal 1 — backend
npm install && npm run prisma:migrate && npm run dev

# terminal 2 — frontend
cd web && npm install && npm run dev
```

Ouvrir `http://localhost:5173`.

## Pages

- `/inscription` — création de compte.
- `/login` — email + mot de passe.
- `/` — tableau de bord (compte à rebours, suivi BRM, BRM choisis par le groupe).
- `/securite` — déconnexion des autres sessions.
