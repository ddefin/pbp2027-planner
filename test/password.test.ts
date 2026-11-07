import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("un-mot-de-passe-solide");
    expect(await verifyPassword("un-mot-de-passe-solide", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("un-mot-de-passe-solide");
    expect(await verifyPassword("autre-mot-de-passe", hash)).toBe(false);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const a = await hashPassword("meme-mot-de-passe");
    const b = await hashPassword("meme-mot-de-passe");
    expect(a).not.toEqual(b);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
  });
});
