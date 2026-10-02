import { Request, Response, NextFunction } from "express";
import { UserRole } from "../types";
import { ApiKeyService } from "../services/api-key.service";

const defaultUser = {
  id: 1,
  email: "admin@localhost",
  role: UserRole.ADMIN,
  twoFactorEnabled: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function injectAdmin(req: Request) {
  const session = (req as any).session || {};
  session.user = { ...defaultUser };
  (req as any).session = session;
  (req as any).apiAuth = true;
}

/**
 * Session OR API key. Used by the existing UI routes.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = ApiKeyService.extractFromRequest(req);
    if (apiKey) {
      if (!(await ApiKeyService.isValid(apiKey))) {
        return res.status(401).json({ error: "Invalid API key" });
      }
      injectAdmin(req);
      return next();
    }

    const session = (req as any).session || {};
    if (!session.user) {
      session.user = { ...defaultUser };
      (req as any).session = session;
    }
    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Auth failed" });
  }
};

/**
 * API key required (X-API-Key or Authorization: Bearer).
 */
export const requireApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = ApiKeyService.extractFromRequest(req);
    if (!apiKey) {
      return res.status(401).json({
        error: "API key required. Pass X-API-Key or Authorization: Bearer <key>",
      });
    }
    if (!(await ApiKeyService.isValid(apiKey))) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    injectAdmin(req);
    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Auth failed" });
  }
};

/**
 * Admin check — still injects default admin for local usage.
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  return requireAuth(req, res, next);
};
