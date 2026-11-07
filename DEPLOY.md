# Déploiement sur un Synology (NAS personnel)

Architecture : un seul conteneur Docker sert le frontend (fichiers statiques) et le
backend (API + WebSocket) sur le même port — cohérent avec le reste de l'app, qui
suppose une seule origine (voir `web/README.md`). Pas de FTP ni d'hébergement
mutualisé dans cette chaîne : le mutualisé OVH ne peut pas faire tourner un process
Node en continu ni relayer du WebSocket, donc il reste entièrement en dehors de ce
déploiement (le widget météo existant sur `lameteoducyclo.fr` n'est pas touché).

```
Internet → DNS (pbp2027.lameteoducyclo.fr) → ton IP/DDNS → reverse proxy DSM (HTTPS)
         → conteneur Docker sur le NAS (port 3001, écoute en local uniquement)
```

## 1. DNS (chez OVH)

Dans la zone DNS du domaine (Espace client OVH → Web Cloud → Noms de domaine →
`lameteoducyclo.fr` → Zone DNS — **pas** dans l'hébergement mutualisé, ce sont deux
écrans différents) :

- Si tu as une IP fixe : une entrée **A** `pbp2027` → ton IP publique.
- Si ton IP change (la plupart des connexions grand public) : utilise le DDNS
  Synology (Panneau de configuration → QuickConnect → DDNS, gratuit, donne un nom du
  type `tonnas.synology.me`), puis une entrée **CNAME** `pbp2027` → `tonnas.synology.me`.

## 2. Reverse proxy + HTTPS (DSM)

1. **Certificat** : Panneau de configuration → Sécurité → Certificat → Ajouter →
   Let's Encrypt, nom de domaine `pbp2027.lameteoducyclo.fr`. Nécessite que le port 80
   soit accessible depuis l'extérieur le temps de la validation (redirection de port
   sur ta box si ce n'est pas déjà fait pour un autre usage).
2. **Règle de reverse proxy** : Panneau de configuration → Portail de connexion →
   Avancé → Reverse Proxy → Créer.
   - Source : `pbp2027.lameteoducyclo.fr`, HTTPS, port 443, **coche "Activer HSTS" et
     "Prise en charge de WebSocket"** (indispensable pour le chat temps réel).
   - Destination : `localhost`, HTTP, port `3001` (celui publié par
     `docker-compose.yml` — change-le des deux côtés si tu dois le changer).

## 3. Runner GitHub Actions (sur le NAS)

Le déploiement se fait par un **runner auto-hébergé** : pas d'accès SSH exposé sur
Internet, pas de clé SSH à stocker comme secret GitHub. Le runner tourne *sur* le
NAS et c'est lui qui construit l'image Docker et redémarre le conteneur, en local.

1. Dans GitHub : Settings du repo → Actions → Runners → **New self-hosted runner** →
   Linux. GitHub affiche des commandes avec un jeton d'enregistrement à usage unique
   (ne le partage avec personne, il expire vite).
2. Connecte-toi en SSH au NAS, crée un dossier dédié (ex. `~/actions-runner`), et
   lance exactement les commandes que GitHub t'a données (`curl` pour télécharger,
   puis `./config.sh --url ... --token ...`).
3. **Ajoute un label** quand `config.sh` le demande (ou via `--labels synology`) :
   le workflow cible `runs-on: [self-hosted, synology]`, donc ce label doit être
   présent sur ce runner — sinon le job `deploy` reste bloqué "en attente".
4. Fais tourner le runner en service (`sudo ./svc.sh install && sudo ./svc.sh start`)
   pour qu'il survive aux redémarrages du NAS. S'il n'a pas les droits root
   nécessaires sur ton DSM, utilise plutôt le Planificateur de tâches DSM pour lancer
   `run.sh` au démarrage.
5. L'utilisateur qui fait tourner le runner doit pouvoir exécuter `docker compose` —
   ajoute-le au groupe `docker` (Panneau de configuration → Groupe d'utilisateurs, ou
   `synogroup --member docker <utilisateur>` en SSH), puis reconnecte-toi pour que ça
   s'applique.

## 4. Première configuration (une fois, à la main sur le NAS)

```bash
# Dans le dossier où le runner a cloné le repo (généralement
# ~/actions-runner/_work/pbp2027-planner/pbp2027-planner) :
cp .env.production.example .env.production
nano .env.production   # renseigne MFA_ENCRYPTION_KEY (openssl rand -hex 32),
                        # OPENWEATHER_API_KEY si tu l'utilises, etc.
```

Ce fichier n'est **jamais** commité ni poussé sur GitHub (il est dans
`.gitignore`) — c'est la bonne place pour ces valeurs, pas un secret GitHub
Actions, qui ne serait injecté que dans les workflows CI, jamais sur le
serveur qui tourne en continu.

Le dossier `./data` (créé automatiquement à côté, par `docker-compose.yml`)
contient la base SQLite — à inclure dans tes sauvegardes NAS (Hyper Backup,
par exemple), c'est la seule donnée qui ne se régénère pas en redéployant.

## 5. Déploiement

Pousser sur `main` suffit : le workflow `.github/workflows/deploy.yml` fait tourner
les tests (sur un runner GitHub classique, pas sur ton NAS), et seulement s'ils
passent, construit l'image et relance le conteneur sur le NAS.

Pour forcer un déploiement manuel depuis le NAS (sans attendre un push) :

```bash
cd ~/actions-runner/_work/pbp2027-planner/pbp2027-planner
docker compose up -d --build
```

## Dépannage

- **Le job `deploy` reste "en attente" sur GitHub** : le runner n'est pas démarré, ou
  le label `synology` ne correspond pas — vérifie Settings → Actions → Runners (doit
  afficher "Idle", pas "Offline").
- **`docker compose` échoue avec une erreur de permissions** : l'utilisateur du runner
  n'est pas dans le groupe `docker` (étape 3.5 ci-dessus).
- **Le chat ne se connecte pas (WebSocket)** : vérifie que "Prise en charge de
  WebSocket" est bien cochée dans la règle de reverse proxy DSM.
- **`.env.production manquant`** : étape 4 pas encore faite, ou faite dans le mauvais
  dossier (celui où le runner clone réellement le repo, pas ton `$HOME`).
