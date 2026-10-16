import crypto from "crypto";

// scrypt, stored as "salt:hash" (hex). Node built-in, so no new dependency.
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  return crypto.timingSafeEqual(crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length), expected);
}
