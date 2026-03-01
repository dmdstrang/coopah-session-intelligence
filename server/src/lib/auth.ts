import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;
const SECRET = process.env.JWT_SECRET || "coopah-dev-secret-change-in-production";
const COOKIE_NAME = "coopah_session";
const COOKIE_MAX_AGE_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN);
  return salt.toString("hex") + ":" + hash.toString("hex");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, KEY_LEN);
  return timingSafeEqual(hash, derived);
}

function signPayload(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function createToken(userId: number): string {
  const exp = Date.now() + COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}:${exp}`;
  return Buffer.from(payload + "." + signPayload(payload)).toString("base64url");
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [payload, sig] = decoded.split(".");
    if (!payload || !sig || sig !== signPayload(payload)) return null;
    const [userIdStr, expStr] = payload.split(":");
    const exp = parseInt(expStr, 10);
    if (Date.now() > exp) return null;
    return { userId: parseInt(userIdStr, 10) };
  } catch {
    return null;
  }
}

export function getCookieName(): string {
  return COOKIE_NAME;
}

export function getCookieMaxAge(): number {
  return COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
}