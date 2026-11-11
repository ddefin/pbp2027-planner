#!/bin/sh
# Déploiement automatique, à lancer sur l'hôte (le NAS), pas dans un conteneur.
# Prévu pour le Planificateur de tâches DSM (tâche déclenchée, toutes les 5 min,
# voir DEPLOY.md) — vérifie les derniers commits sur main et redéploie si besoin.
#
# Pourquoi pas un job GitHub Actions sur un runner self-hébergé ? Ce runner
# tournerait dans son propre conteneur Docker, avec son propre clone du dépôt.
# `docker compose up` lancé depuis là-dedans parle bien au Docker du NAS (socket
# monté), mais résout "./data" comme un chemin DANS CE CONTENEUR — pas le vrai
# dossier de données de prod sur le NAS. Un déploiement CI qui irait jusqu'au
# bout risquerait de faire tourner l'app sur un dossier data/ vide plutôt que la
# vraie base. Ce script, lui, tourne directement sur l'hôte : aucune ambiguïté.
#
# Idempotent et peu coûteux à relancer souvent : si rien n'a changé, le "git pull"
# ne fait rien et le "docker compose build" ressort tout en cache (quelques
# secondes) — `up -d` sans --force-recreate ne redémarre le conteneur que si
# l'image a réellement changé.
#
# Chaque passage est journalisé dans deploy.log (à la racine du dépôt, non suivi par
# git) : date, version avant/après, et l'erreur EXACTE si quelque chose échoue — sans
# ça, un déploiement bloqué (pull refusé, build en échec) restait invisible, l'ancien
# conteneur continuant de tourner sans que rien ne le signale.
set -u

cd "$(dirname "$0")/.."
LOG=deploy.log

# safe.directory : le conteneur git tourne en root alors que le dépôt appartient à
# l'utilisateur du NAS — sans ça, git refuse d'y travailler ("dubious ownership").
git_() { docker run --rm -v "$(pwd):/repo" -w /repo alpine/git -c safe.directory=/repo "$@"; }

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Journal borné à ~2000 lignes (une tâche toutes les 5 min en produit beaucoup).
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

BEFORE=$(git_ rev-parse --short HEAD 2>/dev/null || echo "?")
if ! OUT=$(git_ pull --ff-only origin main 2>&1); then
  log "ÉCHEC git pull (reste sur $BEFORE) : $OUT"
  log "  → si des fichiers suivis ont été modifiés sur le NAS : git status, puis git checkout -- <fichier> (ou git stash)"
  exit 1
fi
AFTER=$(git_ rev-parse --short HEAD 2>/dev/null || echo "?")

# Version embarquée dans l'image (affichée dans l'app : "Mon profil" et /health).
APP_VERSION="$(git_ log -1 --format='%h %cs' 2>/dev/null || echo "$AFTER")"
export APP_VERSION

if [ "$BEFORE" != "$AFTER" ]; then log "nouveau code : $BEFORE → $AFTER, reconstruction…"; fi
if ! OUT=$(docker compose up -d --build 2>&1); then
  log "ÉCHEC build/démarrage ($AFTER), l'ancienne version continue de tourner :"
  echo "$OUT" | tail -n 40 >> "$LOG"
  exit 1
fi
if [ "$BEFORE" != "$AFTER" ]; then log "déployé : $APP_VERSION"; fi
docker image prune -f > /dev/null 2>&1 || true
