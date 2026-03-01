import type { Request, Response, NextFunction } from "express";
import { verifyToken, getCookieName } from "../lib/auth.js";

export interface AuthRequest extends Request {
  userId?: number;
}

function getTokenFromCookie(req: Request): string | null {
  const name = getCookieName();
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.split(";").find((s) => s.trim().startsWith(name + "="));
  if (!match) return null;
  return decodeURIComponent(match.trim().slice(name.length + 1).replace(/^"(.*)"$/, "$1"));
}

/** Set req.userId if valid session cookie present. Does not reject. */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const token = getTokenFromCookie(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.userId = payload.userId;
  }
  next();
}

/** Require auth: 401 if no valid session. */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = getTokenFromCookie(req);
  if (!token) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }
  req.userId = payload.userId;
  next();
}
