import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getSessionUser } from "../lib/session.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { deleteUploadedFile, readUploadedFile, saveUploadedFile } from "../lib/fileStorage.js";
import { createTelegramLinkCode } from "../lib/telegramBot.js";
import { randomBytes } from "node:crypto";
import { AVATAR_COLORS, AVATAR_ICONS, MAX_AVATAR_BYTES, avatarOf, parseAvatar, sniffImage, stripImageMetadata } from "../lib/avatar.js";
import { checkRateLimit } from "../lib/rateLimit.js";

const MAX_LICENSE_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo : large pour un scan/une photo
const LICENSE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const prenomSchema = z.string().trim().min(1).max(60);
const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const updateProfileSchema = z.object({
  prenom: prenomSchema.optional(),
  licenceNumero: optionalTextSchema(40),
  club: optionalTextSchema(120),
  notebook: optionalTextSchema(20000),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(256),
});

const eventSchema = z.object({
  title: z.string().trim().min(1).max(150),
  date: z.string().datetime().or(z.string().min(1)), // accepte "YYYY-MM-DD" ou ISO complet
  notes: z.string().trim().max(2000).optional().nullable(),
});

function serializeEvent(e: { id: string; title: string; date: Date; notes: string | null }) {
  return { id: e.id, title: e.title, date: e.date.toISOString(), notes: e.notes };
}

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    return reply.send({
      email: user.email,
      prenom: user.prenom,
      licenceNumero: user.licenceNumero,
      club: user.club,
      notebook: user.notebook,
      avatar: avatarOf(user),
    });
  });

  // ─── Avatar ───
  const presetSchema = z.object({ icon: z.enum(AVATAR_ICONS), color: z.enum(AVATAR_COLORS) });

  // Efface la photo précédente du disque (changement d'avatar ou retour aux initiales).
  async function dropPhoto(raw: string | null) {
    const prev = parseAvatar(raw);
    if (prev?.kind === "photo") await deleteUploadedFile(prev.path);
  }

  app.put("/profile/avatar", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = presetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    await dropPhoto(user.avatar);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { avatar: JSON.stringify({ kind: "preset", ...parsed.data }), avatarKey: null } });
    return reply.send({ avatar: avatarOf(updated) });
  });

  app.post("/profile/avatar/photo", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!checkRateLimit(`avatar:${user.id}`, 10, 3_600_000).allowed) return reply.code(429).send({ error: "too_many_requests" });
    const file = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES } }).catch(() => undefined);
    if (!file) return reply.code(400).send({ error: "missing_file" });
    const raw = await file.toBuffer().catch(() => null);
    if (!raw || file.file.truncated) return reply.code(413).send({ error: "file_too_large" });
    // Type vérifié sur le contenu réel (signature binaire), pas sur le nom ni le type déclaré.
    const type = sniffImage(raw);
    if (!type) return reply.code(415).send({ error: "unsupported_image" });
    let clean: Buffer;
    try {
      clean = stripImageMetadata(raw, type);
    } catch {
      return reply.code(415).send({ error: "unsupported_image" });
    }
    const path = await saveUploadedFile("avatars", clean);
    await dropPhoto(user.avatar);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatar: JSON.stringify({ kind: "photo", path, v: Date.now(), type }), avatarKey: randomBytes(12).toString("base64url") },
    });
    return reply.send({ avatar: avatarOf(updated) });
  });

  app.delete("/profile/avatar", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    await dropPhoto(user.avatar);
    await prisma.user.update({ where: { id: user.id }, data: { avatar: null, avatarKey: null } });
    return reply.send({ avatar: null });
  });

  // Photo d'un membre : réservée aux membres connectés (jamais publique).
  app.get("/avatars/:key", async (request, reply) => {
    const viewer = await getSessionUser(request);
    if (!viewer) return reply.code(401).send({ error: "unauthenticated" });
    const { key } = request.params as { key: string };
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(key)) return reply.code(404).send({ error: "not_found" });
    const owner = await prisma.user.findUnique({ where: { avatarKey: key }, select: { avatar: true } });
    const a = parseAvatar(owner?.avatar) as { kind: string; path?: string; type?: string } | null;
    if (!a || a.kind !== "photo" || !a.path) return reply.code(404).send({ error: "not_found" });
    const data = await readUploadedFile(a.path).catch(() => null);
    if (!data) return reply.code(404).send({ error: "not_found" });
    reply.header("content-type", sniffImage(data) ?? "application/octet-stream");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "default-src 'none'");
    // L'adresse change à chaque nouvelle photo (?v=) : cache long, mais privé.
    reply.header("cache-control", "private, max-age=604800, immutable");
    return reply.send(data);
  });

  app.patch("/profile", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data,
    });

    return reply.send({
      email: updated.email,
      prenom: updated.prenom,
      licenceNumero: updated.licenceNumero,
      club: updated.club,
      notebook: updated.notebook,
    });
  });

  app.post("/profile/change-password", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return reply.code(401).send({ error: "invalid_current_password" });

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    return reply.send({ status: "password_changed" });
  });

  // Événements personnels : entièrement privés, jamais filtrés/partagés au
  // groupe (contrairement aux Sorties ou au calendrier BRM) — un randonneur ne
  // voit et ne modifie jamais que les siens.
  app.get("/profile/events", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const events = await prisma.personalEvent.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    return reply.send({ events: events.map(serializeEvent) });
  });

  app.post("/profile/events", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    const date = new Date(parsed.data.date);
    if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: "invalid_date" });

    const event = await prisma.personalEvent.create({
      data: { userId: user.id, title: parsed.data.title, date, notes: parsed.data.notes || null },
    });
    return reply.code(201).send({ event: serializeEvent(event) });
  });

  app.patch("/profile/events/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.personalEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const parsed = eventSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });

    let date: Date | undefined;
    if (parsed.data.date !== undefined) {
      date = new Date(parsed.data.date);
      if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: "invalid_date" });
    }

    const event = await prisma.personalEvent.update({
      where: { id },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(date ? { date } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
      },
    });
    return reply.send({ event: serializeEvent(event) });
  });

  app.delete("/profile/events/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const existing = await prisma.personalEvent.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await prisma.personalEvent.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Licence FFCT/ACP (PDF/PNG/JPEG) : chaque upload s'ajoute à la collection plutôt
  // que de remplacer le précédent — la plus récente (createdAt) est "la courante"
  // côté interface, les autres forment l'archive. Rien n'est jamais écrasé.
  app.get("/profile/license", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const docs = await prisma.licenseDocument.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, fileMimeType: true, createdAt: true },
    });
    return reply.send({ documents: docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })) });
  });

  app.post("/profile/license", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const file = await request.file({ limits: { fileSize: MAX_LICENSE_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "no_file" });
    const mimeType = file.mimetype || "application/octet-stream";
    if (!LICENSE_MIME_TYPES.has(mimeType)) return reply.code(400).send({ error: "invalid_file_type" });

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_LICENSE_FILE_BYTES) return reply.code(413).send({ error: "file_too_large" });

    const filePath = await saveUploadedFile("licenses", buffer);
    const doc = await prisma.licenseDocument.create({
      data: { userId: user.id, fileName: file.filename, fileMimeType: mimeType, filePath },
    });

    return reply.code(201).send({
      document: { id: doc.id, fileName: doc.fileName, fileMimeType: doc.fileMimeType, createdAt: doc.createdAt.toISOString() },
    });
  });

  app.get("/profile/license/:id/file", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const doc = await prisma.licenseDocument.findUnique({ where: { id } });
    if (!doc || doc.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const content = await readUploadedFile(doc.filePath);
    reply.header("content-type", doc.fileMimeType);
    reply.header("content-disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`);
    return reply.send(content);
  });

  app.delete("/profile/license/:id", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { id } = request.params as { id: string };
    const doc = await prisma.licenseDocument.findUnique({ where: { id } });
    if (!doc || doc.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await deleteUploadedFile(doc.filePath);
    await prisma.licenseDocument.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Statut de la liaison Telegram (section "Telegram" de "Mon profil") : jamais
  // le chatId lui-même, c'est un identifiant Telegram interne sans utilité
  // côté client une fois la liaison faite.
  app.get("/profile/telegram", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const link = await prisma.telegramLink.findUnique({ where: { userId: user.id } });
    return reply.send({
      linked: link !== null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      configured: Boolean(config.telegramBotToken),
      botUsername: config.telegramBotUsername,
    });
  });

  // Génère (ou renouvelle) le code à envoyer au bot via "/start <code>" — voir
  // src/lib/telegramBot.ts. Le bot doit être configuré (TELEGRAM_BOT_TOKEN) :
  // sans ça, aucun code n'ouvrirait jamais de liaison, inutile d'en créer un.
  app.post("/profile/telegram/link-code", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!config.telegramBotToken) return reply.code(503).send({ error: "not_configured" });

    const { code, expiresAt } = await createTelegramLinkCode(user.id);
    return reply.send({ code, expiresAt: expiresAt.toISOString() });
  });

  app.delete("/profile/telegram", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    await prisma.telegramLink.deleteMany({ where: { userId: user.id } });
    return reply.code(204).send();
  });
}
