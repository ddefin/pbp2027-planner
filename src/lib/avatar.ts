// Avatars des randonneurs : illustré (icône + couleur, listes fermées) ou photo.
// La photo est servie par /api/avatars/:key (membres connectés) ; la clé est un jeton
// aléatoire, jamais l'id du compte.

export const AVATAR_ICONS = ["bike", "mountain", "sun", "moon", "wind", "coffee", "flag", "compass", "map", "zap", "heart", "star", "croissant", "tent", "trees", "waves"] as const;
export const AVATAR_COLORS = ["coral", "blue", "green", "amber", "violet", "teal", "slate", "rose"] as const;

export type AvatarIcon = (typeof AVATAR_ICONS)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

type Stored = { kind: "preset"; icon: AvatarIcon; color: AvatarColor } | { kind: "photo"; path: string; v: number };
export type PublicAvatar = { kind: "preset"; icon: AvatarIcon; color: AvatarColor } | { kind: "photo"; url: string } | null;

export function parseAvatar(raw: string | null | undefined): Stored | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Stored;
    if (a.kind === "preset" && (AVATAR_ICONS as readonly string[]).includes(a.icon) && (AVATAR_COLORS as readonly string[]).includes(a.color)) return a;
    if (a.kind === "photo" && typeof a.path === "string") return a;
  } catch {
    /* valeur illisible : pas d'avatar */
  }
  return null;
}

// Ce que voient les autres membres (jamais le chemin du fichier sur le disque).
export function avatarOf(user: { avatar?: string | null; avatarKey?: string | null }): PublicAvatar {
  const a = parseAvatar(user.avatar);
  if (!a) return null;
  if (a.kind === "preset") return { kind: "preset", icon: a.icon, color: a.color };
  return user.avatarKey ? { kind: "photo", url: `/api/avatars/${user.avatarKey}?v=${a.v}` } : null;
}

export const AVATAR_SELECT = { avatar: true, avatarKey: true } as const;

// ─── Photo : contrôle du format et retrait des métadonnées (position GPS, appareil…) ───

export const MAX_AVATAR_BYTES = 300 * 1024;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(b: Buffer): ImageType | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// JPEG : on garde APP0 (JFIF) et tout ce qui décrit l'image ; on retire APP1 à APP15
// (EXIF, XMP, GPS…) et les commentaires.
function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error("jpeg");
    const marker = b[i + 1];
    if (marker === 0xda) {
      out.push(b.subarray(i)); // début des données image : on copie la suite telle quelle
      return Buffer.concat(out);
    }
    const len = b.readUInt16BE(i + 2);
    const seg = b.subarray(i, i + 2 + len);
    if (seg.length !== 2 + len) throw new Error("jpeg");
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  throw new Error("jpeg");
}

// PNG : on retire les blocs de texte, EXIF et date.
function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  const dropped = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString("ascii", i + 4, i + 8);
    const chunk = b.subarray(i, i + 12 + len);
    if (chunk.length !== 12 + len) throw new Error("png");
    if (!dropped.has(type)) out.push(chunk);
    i += 12 + len;
    if (type === "IEND") return Buffer.concat(out);
  }
  throw new Error("png");
}

// WebP : on retire les blocs EXIF et XMP, et on remet à zéro leurs indicateurs.
function stripWebp(b: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = b.toString("ascii", i, i + 4);
    const len = b.readUInt32LE(i + 4);
    const padded = len + (len % 2);
    const chunk = Buffer.from(b.subarray(i, i + 8 + padded));
    if (chunk.length < 8 + len) throw new Error("webp");
    if (type === "VP8X") chunk[8] &= ~0x0c; // indicateurs EXIF (0x08) et XMP (0x04)
    if (type !== "EXIF" && type !== "XMP ") out.push(chunk);
    i += 8 + padded;
  }
  const body = Buffer.concat(out);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

export function stripImageMetadata(b: Buffer, type: ImageType): Buffer {
  if (type === "image/jpeg") return stripJpeg(b);
  if (type === "image/png") return stripPng(b);
  return stripWebp(b);
}
