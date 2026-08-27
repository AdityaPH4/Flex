import crypto from "crypto";

// 6-digit numeric OTP. Never store or log the raw code outside the dev SMS provider.
export function generateOtpCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function hashOtpCode(code: string, phone: string): string {
  // Salting with the phone number is enough here since codes are short-lived
  // and single-use; this isn't protecting a long-term secret.
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

export function verifyOtpCode(code: string, phone: string, hash: string): boolean {
  const candidate = hashOtpCode(code, phone);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}
