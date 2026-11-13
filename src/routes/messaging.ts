import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSessionUser } from "../lib/session.js";
import { publicName } from "../lib/publicName.js";
import { broadcast, dmRoomKey, GENERAL_ROOM_KEY } from "../ws/messaging.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";

const MESSAGE_PAGE_SIZE = 200;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo : large pour une photo, raisonnable pour une pièce jointe de chat
const locationSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

type GroupMessageRow = {
  id: string;
  user: { prenom: string };
  userId: string;
  text: string;
  kind: string;
  lat: number | null;
  lon: number | null;
  fileName: string | null;
  fileMimeType: string | null;
  createdAt: Date;
};

function serializeGroup(m: GroupMessageRow) {
  return {
    id: m.id,
    who: publicName(m.user),
    fromUserId: m.userId,
    text: m.text,
    kind: m.kind,
    lat: m.lat,
    lon: m.lon,
    fileName: m.fileName,
    fileMimeType: m.fileMimeType,
    hasFile: m.fileName !== null,
    createdAt: m.createdAt.toISOString(),
  };
}

type DirectMessageRow = {
  id: string;
  senderId: string;
  text: string;
  kind: string;
  lat: number | null;
  lon: number | null;
  fileName: string | null;
  fileMimeType: string | null;
  createdAt: Date;
};

function serializeDirect(m: DirectMessageRow) {
  return {
    id: m.id,
    fromUserId: m.senderId,
    text: m.text,
    kind: m.kind,
    lat: m.lat,
    lon: m.lon,
    fileName: m.fileName,
    fileMimeType: m.fileMimeType,
    hasFile: m.fileName !== null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function messagingRoutes(app: FastifyInstance) {
  // Liste des randonneurs avec qui démarrer une conversation privée — jamais l'email,
  // seulement id + prénom (voir src/lib/publicName.ts).
  app.get("/messaging/users", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const users = await prisma.user.findMany({
      // Ni le compte système « Membre supprimé », ni les comptes suspendus.
      where: { id: { not: user.id }, isSystem: false, suspendedAt: null },
      select: { id: true, prenom: true },
      orderBy: { prenom: "asc" },
    });
    return reply.send({ users });
  });

  app.get("/messaging/general/messages", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const messages = await prisma.groupMessage.findMany({
      orderBy: { createdAt: "asc" },
      take: MESSAGE_PAGE_SIZE,
      include: { user: { select: { prenom: true } } },
    });
    return reply.send({ messages: messages.map(serializeGroup) });
  });

  // Partage de position dans le salon général : un message de type "location", pas
  // de texte libre — même mécanisme de diffusion que les messages texte envoyés par
  // WebSocket (voir src/ws/messaging.ts), mais déclenché depuis une route REST
  // classique puisqu'il n'y a pas de contenu à taper dans le champ de saisie.
  app.post("/messaging/general/location", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = locationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const message = await prisma.groupMessage.create({
      data: { userId: user.id, text: "", kind: "location", lat: parsed.data.lat, lon: parsed.data.lon },
    });
    broadcast(GENERAL_ROOM_KEY, { type: "message", ...serializeGroup({ ...message, user: { prenom: user.prenom } }) });
    return reply.code(201).send({ message: serializeGroup({ ...message, user: { prenom: user.prenom } }) });
  });

  // Pièce jointe dans le salon général : contenu stocké tel quel en base (comme les
  // GPX de Parcours/CatalogTrack) — pas de stockage externe pour l'instant.
  app.post("/messaging/general/files", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const file = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const filePath = await saveUploadedFile("messages", buffer);
    const message = await prisma.groupMessage.create({
      data: {
        userId: user.id,
        text: "",
        kind: "file",
        fileName: file.filename,
        fileMimeType: file.mimetype || "application/octet-stream",
        filePath,
      },
    });
    broadcast(GENERAL_ROOM_KEY, { type: "message", ...serializeGroup({ ...message, user: { prenom: user.prenom } }) });
    return reply.code(201).send({ message: serializeGroup({ ...message, user: { prenom: user.prenom } }) });
  });

  app.get("/messaging/general/files/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const message = await prisma.groupMessage.findUnique({ where: { id } });
    if (!message || !message.fileName || (!message.filePath && !message.fileData)) {
      return reply.code(404).send({ error: "not_found" });
    }

    const content = message.filePath ? await readUploadedFile(message.filePath) : message.fileData!;

    reply.header("content-type", message.fileMimeType ?? "application/octet-stream");
    reply.header("content-disposition", `inline; filename="${message.fileName.replace(/"/g, "")}"`);
    return reply.send(content);
  });

  // Seul l'auteur peut supprimer son propre message — jamais un message d'un autre,
  // même dans le salon général.
  app.delete("/messaging/general/messages/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const message = await prisma.groupMessage.findUnique({ where: { id } });
    if (!message) return reply.code(404).send({ error: "not_found" });
    if (message.userId !== user.id) return reply.code(403).send({ error: "forbidden" });

    if (message.filePath) await deleteUploadedFile(message.filePath);
    await prisma.groupMessage.delete({ where: { id } });
    broadcast(GENERAL_ROOM_KEY, { type: "message_deleted", id });
    return reply.code(204).send();
  });

  // Une ligne par interlocuteur avec qui une conversation existe (dans un sens ou
  // l'autre), triée par dernier message, avec un compteur de non-lus.
  app.get("/messaging/dm/conversations", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const messages = await prisma.directMessage.findMany({
      where: { OR: [{ senderId: user.id }, { recipientId: user.id }] },
      orderBy: { createdAt: "desc" },
      include: { sender: { select: { id: true, prenom: true } }, recipient: { select: { id: true, prenom: true } } },
    });

    const byPeer = new Map<
      string,
      { peerId: string; prenom: string; lastText: string; lastAt: string; unread: number }
    >();
    for (const m of messages) {
      const peer = m.senderId === user.id ? m.recipient : m.sender;
      const existing = byPeer.get(peer.id);
      const preview = m.kind === "location" ? "📍 Position" : m.kind === "file" ? `📎 ${m.fileName ?? "Fichier"}` : m.text;
      if (!existing) {
        byPeer.set(peer.id, {
          peerId: peer.id,
          prenom: peer.prenom,
          lastText: preview,
          lastAt: m.createdAt.toISOString(),
          unread: m.recipientId === user.id && m.readAt === null ? 1 : 0,
        });
      } else if (m.recipientId === user.id && m.readAt === null) {
        existing.unread += 1;
      }
    }

    return reply.send({ conversations: Array.from(byPeer.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt)) });
  });

  app.get("/messaging/dm/:peerId/messages", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId } = request.params as { peerId: string };
    const peer = await prisma.user.findUnique({ where: { id: peerId }, select: { id: true } });
    if (!peer) return reply.code(404).send({ error: "not_found" });

    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: user.id, recipientId: peerId },
          { senderId: peerId, recipientId: user.id },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: MESSAGE_PAGE_SIZE,
    });

    // Marque comme lus les messages reçus de ce correspondant précis, maintenant
    // qu'on vient d'en afficher l'historique.
    await prisma.directMessage.updateMany({
      where: { senderId: peerId, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });

    return reply.send({ messages: messages.map(serializeDirect) });
  });

  app.post("/messaging/dm/:peerId/location", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId } = request.params as { peerId: string };
    if (peerId === user.id) return reply.code(400).send({ error: "cannot_message_self" });
    const peer = await prisma.user.findUnique({ where: { id: peerId } });
    if (!peer || peer.isSystem || peer.suspendedAt) return reply.code(404).send({ error: "not_found" });

    const parsed = locationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const message = await prisma.directMessage.create({
      data: { senderId: user.id, recipientId: peerId, text: "", kind: "location", lat: parsed.data.lat, lon: parsed.data.lon },
    });
    const serialized = serializeDirect(message);
    broadcast(dmRoomKey(user.id, peerId), { type: "message", who: publicName(user), ...serialized });
    return reply.code(201).send({ message: serialized });
  });

  app.post("/messaging/dm/:peerId/files", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId } = request.params as { peerId: string };
    if (peerId === user.id) return reply.code(400).send({ error: "cannot_message_self" });
    const peer = await prisma.user.findUnique({ where: { id: peerId } });
    if (!peer || peer.isSystem || peer.suspendedAt) return reply.code(404).send({ error: "not_found" });

    const file = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const filePath = await saveUploadedFile("messages", buffer);
    const message = await prisma.directMessage.create({
      data: {
        senderId: user.id,
        recipientId: peerId,
        text: "",
        kind: "file",
        fileName: file.filename,
        fileMimeType: file.mimetype || "application/octet-stream",
        filePath,
      },
    });
    const serialized = serializeDirect(message);
    broadcast(dmRoomKey(user.id, peerId), { type: "message", who: publicName(user), ...serialized });
    return reply.code(201).send({ message: serialized });
  });

  app.get("/messaging/dm/:peerId/files/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId, id } = request.params as { peerId: string; id: string };
    const message = await prisma.directMessage.findUnique({ where: { id } });
    if (!message || !message.fileName || (!message.filePath && !message.fileData)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const isParty = (message.senderId === user.id && message.recipientId === peerId) || (message.recipientId === user.id && message.senderId === peerId);
    if (!isParty) return reply.code(403).send({ error: "forbidden" });

    const content = message.filePath ? await readUploadedFile(message.filePath) : message.fileData!;

    reply.header("content-type", message.fileMimeType ?? "application/octet-stream");
    reply.header("content-disposition", `inline; filename="${message.fileName.replace(/"/g, "")}"`);
    return reply.send(content);
  });

  app.delete("/messaging/dm/:peerId/messages/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { peerId, id } = request.params as { peerId: string; id: string };
    const message = await prisma.directMessage.findUnique({ where: { id } });
    if (!message) return reply.code(404).send({ error: "not_found" });
    if (message.senderId !== user.id) return reply.code(403).send({ error: "forbidden" });

    if (message.filePath) await deleteUploadedFile(message.filePath);
    await prisma.directMessage.delete({ where: { id } });
    broadcast(dmRoomKey(user.id, peerId), { type: "message_deleted", id });
    return reply.code(204).send();
  });
}
