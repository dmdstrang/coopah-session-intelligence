import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, createToken, verifyPassword, getCookieName, getCookieMaxAge } from "../lib/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

export const authRouter = Router();

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${getCookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${getCookieMaxAge()}`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${getCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** POST /api/auth/register — create account. Body: { email, password, displayName? } */
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body as { email?: string; password?: string; displayName?: string };
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password required" });
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return res.status(400).json({ error: "Email required" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await db.select().from(users).where(eq(users.email, trimmed)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const [user] = await db
      .insert(users)
      .values({
        email: trimmed,
        passwordHash: hashPassword(password),
        displayName: typeof displayName === "string" ? displayName.trim() || null : null,
        createdAt: Date.now(),
      })
      .returning();

    if (!user) {
      console.error("Register: insert returned no row");
      return res.status(500).json({ error: "Registration failed" });
    }

    const token = createToken(user.id);
    setSessionCookie(res, token);
    res.status(201).json({
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Register error:", e);
    res.status(500).json({
      error: "Registration failed",
      detail: process.env.NODE_ENV !== "production" ? message : undefined,
    });
  }
});

/** POST /api/auth/login — Body: { email, password } */
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const trimmed = email.trim().toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, trimmed)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createToken(user.id);
    setSessionCookie(res, token);
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? undefined,
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

/** POST /api/auth/logout */
authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** GET /api/auth/me — current user (requires auth via optionalAuth so 401 if none) */
authRouter.get("/me", async (req: AuthRequest, res: Response) => {
  if (req.userId == null) {
    return res.json(null);
  }
  try {
    const [user] = await db.select({ id: users.id, email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, req.userId)).limit(1);
    if (!user) return res.json(null);
    res.json({ id: user.id, email: user.email, displayName: user.displayName ?? undefined });
  } catch {
    res.json(null);
  }
});
