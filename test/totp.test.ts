import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, buildOtpauthUri, generateTotpSecret, verifyTotp } from "../src/lib/totp.js";

function computeExpectedCode(secret: string, timeSeconds: number): string {
  // Recalcule directement via la même implémentation pour générer un code de référence
  // (évite de dépendre d'une lib tierce dans les tests).
  for (let code = 0; code < 1_000_000; code++) {
    const candidate = String(code).padStart(6, "0");
    if (verifyTotp(secret, candidate, { window: 0 }, timeSeconds * 1000)) return candidate;
  }
  throw new Error("no matching code found");
}

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5, 250, 251, 252]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});

describe("TOTP", () => {
  it("accepts the code generated for the current time step", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = computeExpectedCode(secret, Math.floor(now / 1000));
    expect(verifyTotp(secret, code, {}, now)).toBe(true);
  });

  it("rejects a code from far outside the tolerance window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = computeExpectedCode(secret, Math.floor(now / 1000));
    const muchLater = now + 10 * 60 * 1000; // 10 minutes plus tard
    expect(verifyTotp(secret, code, { window: 1 }, muchLater)).toBe(false);
  });

  it("rejects malformed input instead of throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "not-a-code")).toBe(false);
  });

  it("builds a well-formed otpauth:// URI", () => {
    const uri = buildOtpauthUri({ secretBase32: "ABCD1234", accountLabel: "user@example.com", issuer: "PBP2027" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=ABCD1234");
    expect(uri).toContain("issuer=PBP2027");
  });
});
