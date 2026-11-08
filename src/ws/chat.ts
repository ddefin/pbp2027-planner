import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { publicName } from "../lib/publicName.js";

// Registre en mémoire : suffisant pour une seule instance du serveur. Avec plusieurs
// instances derrière un load balancer, il faudrait un pub/sub partagé (Redis) pour que
// les clients connectés à des instances différentes se voient échanger des messages.
const rooms = new Map<string, Set<WebSocket>>();

function broadcast(sortieId: string, payload: unknown) {
  const sockets = rooms.get(sortieId);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

const MAX_MESSAGE_LENGTH = 2000;

export async function chatWsRoutes(app: FastifyInstance) {
  app.get(
    "/sorties/:id/chat",
    {
      websocket: true,
      // Rejette la connexion *avant* le handshake WebSocket (et non après) : sans ce
      // hook, le socket serait accepté puis fermé, ce qui n'est pas la même chose côté
      // client (certains clients ne traitent pas un close juste après l'ouverture).
      preValidation: async (request, reply) => {
        const user = await getSessionUser(request);
        if (!user) return reply.code(401).send({ error: "unauthenticated" });

        const { id } = request.params as { id: string };
        const sortie = await prisma.sortie.findUnique({ where: { id } });
        if (!sortie) return reply.code(404).send({ error: "not_found" });
      },
    },
    async (socket, request) => {
      const { id: sortieId } = request.params as { id: string };

      // Enregistrement synchrone, avant tout await : deux connexions qui arrivent en
      // même temps ne doivent jamais se marcher dessus sur la même entrée de la Map.
      let room = rooms.get(sortieId);
      if (!room) {
        room = new Set();
        rooms.set(sortieId, room);
      }
      room.add(socket);

      socket.on("close", () => {
        room?.delete(socket);
        if (room && room.size === 0) rooms.delete(sortieId);
      });

      // preValidation garantit déjà une session valide ; on la relit seulement pour
      // avoir l'utilisateur à disposition (who, userId) dans les gestionnaires ci-dessous.
      const user = await getSessionUser(request);
      if (!user) {
        socket.close(4401, "unauthenticated");
        room.delete(socket);
        return;
      }

      socket.on("message", async (raw: RawData) => {
        let text: string;
        try {
          const parsed = JSON.parse(raw.toString());
          text = String(parsed.text ?? "").trim();
        } catch {
          return;
        }
        if (!text || text.length > MAX_MESSAGE_LENGTH) return;

        const message = await prisma.chatMessage.create({ data: { sortieId, userId: user.id, text } });

        broadcast(sortieId, {
          type: "message",
          id: message.id,
          who: publicName(user),
          text: message.text,
          createdAt: message.createdAt.toISOString(),
        });
      });
    },
  );
}
