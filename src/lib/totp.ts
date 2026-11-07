import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 4648 base32, sans padding — format attendu par les apps d'authentification.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, recommandation RFC 4226
}

function hotp(secret: Buffer, counter: bigint, digits = 6): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

export interface TotpOptions {
  stepSeconds?: number;
  digits?: number;
  /** Nombre de pas de 30s tolérés de part et d'autre, pour absorber la dérive d'horloge. */
  window?: number;
}

export function verifyTotp(secretBase32: string, code: string, opts: TotpOptions = {}, now = Date.now()): boolean {
  const { stepSeconds = 30, digits = 6, window = 1 } = opts;
  if (!/^\d{6,8}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor(now / 1000 / stepSeconds));
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secret, counter + BigInt(errorWindow), digits);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code.padStart(digits, "0")))) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUri(params: { secretBase32: string; accountLabel: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountLabel}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
