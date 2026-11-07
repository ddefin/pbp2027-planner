# PBP 2027 Planner — service Auth/MFA

Service d'authentification pour le planner de qualification Paris-Brest-Paris 2027.
Dépôt séparé de `lameteoducyclo.fr` (repo `meteo-velo`) — aucun impact sur le site météo existant.

## Choix de sécurité

- **Mots de passe** : `scrypt` (node:crypto, pas de dépendance tierce), sel aléatoire par utilisateur, comparaison en temps constant.
- **Sessions** : cookie `httpOnly`, `SameSite=Strict`, jeton opaque de 256 bits ; seul le hash SHA-256 du jeton est stocké en base (une fuite de la base ne permet pas de rejouer une session). Expiration glissante sur 30 jours.
- **MFA (TOTP, RFC 6238)** : implémentation maison sur `node:crypto` (HMAC-SHA1), secret de 160 bits, fenêtre de tolérance d'une étape de 30s pour la dérive d'horloge. Secret chiffré au repos (AES-256-GCM) avec `MFA_ENCRYPTION_KEY`.
- **Codes de récupération** : 10 codes à usage unique générés à l'activation de la MFA, hachés comme un mot de passe, affichés une seule fois.
- **Verrouillage de compte** : après 8 échecs de mot de passe, compte verrouillé 15 minutes.
- **Rate limiting** : 10 tentatives de login / 15 min par IP, 5 tentatives de code MFA / 5 min par challenge (en mémoire ; à migrer vers un backend partagé type Redis en cas de plusieurs instances).
- **Énumération de comptes** : `/auth/register` et les échecs de `/auth/login` renvoient des réponses génériques.

## Démarrer en local

```bash
cp .env.example .env
# openssl rand -hex 32  → colle le résultat dans MFA_ENCRYPTION_KEY
npm install
npm run prisma:migrate
npm run dev
```

Le service écoute sur `http://localhost:3001`.

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/register` | Création de compte (email + mot de passe) |
| POST | `/auth/login` | Étape 1 : vérifie le mot de passe. Renvoie soit une session, soit un `challengeToken` si la MFA est activée |
| POST | `/auth/mfa/verify` | Étape 2 : vérifie le code TOTP (ou un code de récupération) avec le `challengeToken`, ouvre la session |
| POST | `/auth/mfa/setup` | (authentifié) Génère un secret TOTP en attente + URI `otpauth://` pour le QR code |
| POST | `/auth/mfa/enable` | (authentifié) Confirme le secret en attente avec un premier code, active la MFA, renvoie les codes de récupération |
| POST | `/auth/mfa/disable` | (authentifié) Désactive la MFA |
| GET  | `/auth/session` | (authentifié) Infos de session courante |
| POST | `/auth/logout` | Détruit la session courante |
| POST | `/auth/sessions/revoke-others` | (authentifié) Déconnecte toutes les autres sessions de l'utilisateur |

## Tests

```bash
npm test
```

Couvre le hachage de mot de passe et la génération/vérification TOTP (dont le round-trip base32 et la tolérance de dérive d'horloge).

## Frontend

Le dossier `web/` contient l'app React (Vite) branchée sur ce service : pages de connexion, inscription, MFA (setup/enable/disable), tableau de bord. Voir `web/README.md` pour le détail (notamment le découpage front/back qui évite le CORS en gardant tout sous le même domaine en prod).

## Pour la suite

- Passer `DATABASE_URL` sur Postgres en production (le schéma Prisma est compatible sans changement de code).
- Ajouter l'envoi d'email réel (vérification d'adresse, réinitialisation de mot de passe) — non implémenté ici.
- Compléter `web/src/pages/DashboardPage.tsx` avec le compte à rebours, le suivi des BRM et la coordination des sorties (voir le prototype Artifact).
