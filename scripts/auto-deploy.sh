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

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
  # Lancé à la main dans un terminal : on affiche aussi, au lieu de rester muet.
  if [ -t 1 ]; then echo "$*"; fi
}

# Un seul déploiement à la fois : un build peut durer plus que les 5 min entre deux
# passages de la tâche planifiée — sans verrou, deux builds se chevaucheraient.
LOCK=.deploy.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  # Verrou laissé par un passage interrompu (redémarrage du NAS...) : ignoré après 1 h.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    if [ -t 1 ]; then echo "Un déploiement est déjà en cours (verrou $LOCK) : réessaie dans quelques minutes."; fi
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

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

if [ "$BEFORE" != "$AFTER" ]; then log "nouveau code : $BEFORE → $AFTER"; fi
if [ -t 1 ]; then echo "Construction et démarrage de $APP_VERSION (plusieurs minutes si le code a changé)…"; fi
BUILD_OUT=$(mktemp)
if [ -t 1 ]; then
  # En terminal : progression visible en direct, et gardée pour le journal.
  # Le code de retour de docker ne traverse pas un tube en sh POSIX (pas de
  # pipefail) : on l'écrit dans le flux puis on le relit.
  { docker compose up -d --build 2>&1; echo "__EXIT__$?"; } | tee "$BUILD_OUT" | grep -v '^__EXIT__'
  STATUS=$(sed -n 's/^__EXIT__//p' "$BUILD_OUT" | tail -n 1)
else
  docker compose up -d --build > "$BUILD_OUT" 2>&1; STATUS=$?
fi
if [ "$STATUS" != "0" ]; then
  log "ÉCHEC build/démarrage ($AFTER), l'ancienne version continue de tourner :"
  tail -n 40 "$BUILD_OUT" >> "$LOG"
  rm -f "$BUILD_OUT"
  exit 1
fi
rm -f "$BUILD_OUT"
# Pas une ligne toutes les 5 min quand rien ne change : seulement s'il y a du nouveau
# code, un lancement à la main, ou une réussite qui suit un échec.
if [ "$BEFORE" != "$AFTER" ] || [ -t 1 ] || tail -n 45 "$LOG" 2>/dev/null | grep -q "ÉCHEC"; then
  log "en service : $APP_VERSION"
fi
docker image prune -f > /dev/null 2>&1 || true
