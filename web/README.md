# Frontend — login / MFA

App React (Vite) branchée sur le service d'authentification du dossier parent (`../src`).

## Pourquoi ce découpage front/back

Tout passe par des chemins **relatifs** (`/auth/...`), jamais par une URL absolue vers le backend :

- **En dev**, `vite.config.ts` proxifie `/auth/*` vers `http://localhost:3001`. Le navigateur voit une seule origine (`localhost:5173`), donc pas de CORS et le cookie de session (`SameSite=Strict`) part normalement.
- **En prod**, le reverse proxy (Caddy/Nginx/Traefik) doit faire la même chose : servir les fichiers statiques de `dist/` ET relayer `/auth/*` vers le service backend, sous le **même domaine**. C'est ce qui permet de garder `SameSite=Strict` sur le cookie plutôt que de devoir l'affaiblir en `SameSite=None` + CORS pour un vrai cross-origin.

Exemple Caddy minimal :

```
lameteoducyclo.fr/pbp {
  handle /auth/* {
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
- `/login` — mot de passe, puis étape MFA si elle est activée sur le compte (code TOTP ou code de récupération).
- `/` — tableau de bord (placeholder, à compléter avec le compte à rebours / suivi BRM / sorties).
- `/securite` — activation/désactivation de la MFA (QR code + confirmation, affichage unique des codes de récupération), déconnexion des autres sessions.
