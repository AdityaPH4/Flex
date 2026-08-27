import type { Request, Response, NextFunction } from "express";
import { verifyAdminToken } from "../lib/jwt";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_token" });
  }
  try {
    verifyAdminToken(token);
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
  next();
}
