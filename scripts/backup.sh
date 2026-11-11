#!/bin/sh
# Sauvegarde de la base SQLite de pbp2027-planner, à lancer sur l'hôte (le NAS),
# pas dans le conteneur. Prévu pour le Planificateur de tâches DSM (tâche
# déclenchée, "Exécuter un script défini par l'utilisateur", voir DEPLOY.md).
#
# Utilise "VACUUM INTO" (SQLite) plutôt qu'une simple copie du fichier : ça
# produit une copie transactionnellement cohérente même si l'app écrit en même
# temps, sans avoir besoin d'arrêter le conteneur ni d'installer sqlite3 sur le
# NAS — la commande tourne via le Node déjà présent dans l'image.
set -eu

CONTAINER="${BACKUP_CONTAINER:-pbp2027-planner}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/pbp2027-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP_IN_CONTAINER="/app/data/.backup-tmp-${STAMP}.db"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" node --input-type=module -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.\$executeRawUnsafe(\"VACUUM INTO '${TMP_IN_CONTAINER}'\");
await prisma.\$disconnect();
"

docker cp "${CONTAINER}:${TMP_IN_CONTAINER}" "${BACKUP_DIR}/pbp2027-${STAMP}.db"
docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER"

gzip "${BACKUP_DIR}/pbp2027-${STAMP}.db"

# Purge des sauvegardes plus vieilles que $KEEP_DAYS jours.
find "$BACKUP_DIR" -name 'pbp2027-*.db.gz' -mtime "+${KEEP_DAYS}" -delete

# Témoin lu par l'application (src/lib/backupWatch.ts) : sans lui, elle prévient les
# administrateurs quand plus aucune sauvegarde n'est faite.
docker exec "$CONTAINER" sh -c 'date +%s > /app/data/.last-backup' || echo "Avertissement : témoin de sauvegarde non écrit"

echo "Sauvegarde créée : ${BACKUP_DIR}/pbp2027-${STAMP}.db.gz"
