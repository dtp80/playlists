import { Request, Response, NextFunction } from "express";
import { UserRole } from "../types";

const defaultUser = {
  id: 1,
  email: "admin@localhost",
  role: UserRole.ADMIN,
  twoFactorEnabled: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Authentication is disabled for local-only usage.
 * Inject a default admin user so downstream code keeps working.
 */
export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const session = (req as any).session || {};
  if (!session.user) {
    session.user = defaultUser;
    (req as any).session = session;
  }
  next();
};

/**
 * Admin check is a no-op because we always run as the default admin.
 */
export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const session = (req as any).session || {};
  if (!session.user) {
    session.user = defaultUser;
    (req as any).session = session;
  }
  next();
};
