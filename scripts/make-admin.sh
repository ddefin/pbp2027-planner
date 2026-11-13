#!/bin/sh
# Donne (ou retire) le rôle administrateur à un compte, depuis le NAS.
#   sudo sh scripts/make-admin.sh ton@email.fr          → nomme administrateur
#   sudo sh scripts/make-admin.sh ton@email.fr --retirer → retire le rôle
# L'adresse est passée en variable d'environnement : aucune apostrophe à taper dans du code.
set -eu
EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "Usage : sudo sh scripts/make-admin.sh adresse@email [--retirer]" >&2
  exit 1
fi
VALUE=true
if [ "${2:-}" = "--retirer" ]; then VALUE=false; fi
CONTAINER="${PBP_CONTAINER:-pbp2027-planner}"

docker exec -e TARGET_EMAIL="$EMAIL" -e TARGET_ADMIN="$VALUE" "$CONTAINER" node --input-type=module -e '
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const email = process.env.TARGET_EMAIL.trim().toLowerCase();
const isAdmin = process.env.TARGET_ADMIN === "true";
const u = await p.user.findUnique({ where: { email } });
if (!u) {
  console.error(`Aucun compte avec l’adresse ${email}. Vérifie l’orthographe (ou inscris-toi d’abord sur le site).`);
  await p.$disconnect();
  process.exit(2);
}
await p.user.update({ where: { email }, data: { isAdmin } });
await p.$disconnect();
console.log(isAdmin ? `OK : ${email} est administrateur. Déconnecte-toi puis reconnecte-toi.` : `OK : ${email} n’est plus administrateur.`);
'
