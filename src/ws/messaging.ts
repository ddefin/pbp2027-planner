import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData, WebSocket } from "ws";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { publicName } from "../lib/publicName.js";

type DmRequest = FastifyRequest & { pbpUser?: Awaited<ReturnType<typeof getSessionUser>> };

// Même registre en mémoire que src/ws/chat.ts (voir son commentaire) : suffisant pour
// une seule instance du serveur, pas de pub/sub partagé nécessaire ici.
const rooms = new Map<string, Set<WebSocket>>();

// Exporté : les routes REST (upload de pièce jointe, partage de position,
// suppression — src/routes/messaging.ts) doivent aussi pousser leurs événements aux
// sockets déjà connectés, pas seulement les messages texte envoyés en direct via WS.
export function broadcast(roomKey: string, payload: unknown) {
  const sockets = rooms.get(roomKey);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

function join(roomKey: string, socket: WebSocket): Set<WebSocket> {
  let room = rooms.get(roomKey);
  if (!room) {
    room = new Set();
    rooms.set(roomKey, room);
  }
  room.add(socket);
  socket.on("close", () => {
    room?.delete(socket);
    if (room && room.size === 0) rooms.delete(roomKey);
  });
  return room;
}

// Clé stable pour la room d'une conversation privée : indépendante de qui des deux
// se connecte en premier, pour que A→B et B→A rejoignent la même room.
export function dmRoomKey(a: string, b: string): string {
  return ["dm", ...[a, b].sort()].join(":");
}

const MAX_MESSAGE_LENGTH = 2000;
export const GENERAL_ROOM_KEY = "general";

export async function messagingWsRoutes(app: FastifyInstance) {
  // Salon général : accessible à tout utilisateur connecté, pas de vérification
  // d'appartenance.
  app.get(
    "/messaging/general/chat",
    {
      websocket: true,
      // Utilisateur résolu ici et réutilisé tel quel par le handler (comme pour les
      // messages privés ci-dessous) : un second `await getSessionUser` dans le handler
      // retardait l'enregistrement de socket.on("message"), et un message envoyé dès
      // l'ouverture de la connexion arrivait avant l'écouteur — perdu sans erreur
      // (visible surtout sur un serveur lent ou chargé).
      preValidation: async (request, reply) => {
        const user = await getSessionUser(request);
        if (!user) return reply.code(401).send({ error: "unauthenticated" });
        (request as DmRequest).pbpUser = user;
      },
    },
    async (socket, request) => {
      const user = (request as DmRequest).pbpUser;
      if (!user) {
        socket.close(4401, "unauthenticated");
        return;
      }
      join(GENERAL_ROOM_KEY, socket);

      socket.on("message", async (raw: RawData) => {
        let text: string;
        try {
          const parsed = JSON.parse(raw.toString());
          text = String(parsed.text ?? "").trim();
        } catch {
          return;
        }
        if (!text || text.length > MAX_MESSAGE_LENGTH) return;

        const message = await prisma.groupMessage.create({ data: { userId: user.id, text } });

        broadcast(GENERAL_ROOM_KEY, {
          type: "message",
          id: message.id,
          who: publicName(user),
          fromUserId: user.id,
          text: message.text,
          kind: "text",
          createdAt: message.createdAt.toISOString(),
        });
      });
    },
  );

  // Message privé entre l'utilisateur connecté et :peerId. peerId doit exister ;
  // n'importe quel utilisateur peut écrire à n'importe quel autre (pas de notion de
  // contact/ami pour l'instant).
  app.get(
    "/messaging/dm/:peerId/chat",
    {
      websocket: true,
      // On garde l'utilisateur résolu ici (préValidation, déjà asynchrone) pour que le
      // handler puisse rejoindre la room de façon synchrone, sans nouvel await avant
      // room.add() — sinon deux connexions simultanées pourraient manquer la room le
      // temps de leur propre résolution de session (même raison que dans ws/chat.ts,
      // mais ici la clé de room dépend de l'identité de l'appelant, pas seulement de
      // l'URL, d'où ce détour).
      preValidation: async (request, reply) => {
        const user = await getSessionUser(request);
        if (!user) return reply.code(401).send({ error: "unauthenticated" });

        const { peerId } = request.params as { peerId: string };
        if (peerId === user.id) return reply.code(400).send({ error: "cannot_message_self" });
        const peer = await prisma.user.findUnique({ where: { id: peerId } });
        if (!peer) return reply.code(404).send({ error: "not_found" });

        (request as DmRequest).pbpUser = user;
      },
    },
    async (socket, request) => {
      const { peerId } = request.params as { peerId: string };
      const user = (request as DmRequest).pbpUser;
      if (!user) {
        socket.close(4401, "unauthenticated");
        return;
      }

      const roomKey = dmRoomKey(user.id, peerId);
      join(roomKey, socket);

      socket.on("message", async (raw: RawData) => {
        let text: string;
        try {
          const parsed = JSON.parse(raw.toString());
          text = String(parsed.text ?? "").trim();
        } catch {
          return;
        }
        if (!text || text.length > MAX_MESSAGE_LENGTH) return;

        const message = await prisma.directMessage.create({
          data: { senderId: user.id, recipientId: peerId, text },
        });

        broadcast(roomKey, {
          type: "message",
          id: message.id,
          fromUserId: user.id,
          who: publicName(user),
          text: message.text,
          kind: "text",
          createdAt: message.createdAt.toISOString(),
        });
      });
    },
  );
}
