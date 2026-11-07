#!/bin/bash
set -e

# Déjà enregistré lors d'un démarrage précédent (l'état vit dans le volume monté sur
# /home/runner) : on ne reconfigure pas, RUNNER_TOKEN peut même être absent cette fois
# (les jetons d'enregistrement expirent vite, ce n'est normal que pour le tout premier
# démarrage).
if [ ! -f .runner ]; then
  if [ -z "$RUNNER_TOKEN" ]; then
    echo "Première configuration : RUNNER_TOKEN doit être renseigné (jeton depuis GitHub, Settings > Actions > Runners > New self-hosted runner)." >&2
    exit 1
  fi
  ./config.sh --url "$RUNNER_URL" --token "$RUNNER_TOKEN" \
    --name "${RUNNER_NAME:-synology}" --labels "${RUNNER_LABELS:-self-hosted,synology}" \
    --work _work --unattended --replace
fi

cleanup() {
  echo "Arrêt du runner..."
  ./config.sh remove --unattended --token "$RUNNER_TOKEN" 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT

./run.sh & wait $!
