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
set -eu

cd "$(dirname "$0")/.."

docker run --rm -v "$(pwd):/repo" -w /repo alpine/git pull origin main
docker compose up -d --build
docker image prune -f
