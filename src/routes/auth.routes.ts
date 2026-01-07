import { Router } from "express";
import { UserRole } from "../types";

const router = Router();

const defaultUser = {
  id: 1,
  email: "admin@localhost",
  role: UserRole.ADMIN,
  twoFactorEnabled: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Authentication is disabled for local-only mode; always return the default admin user.
router.post("/login", (_req, res) => {
  res.json({ user: defaultUser });
});

router.post("/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/me", (_req, res) => {
  res.json({ user: defaultUser });
});

// Password / 2FA endpoints are no-ops in local mode.
router.put("/change-password", (_req, res) => {
  res.json({ message: "Password changes are disabled in local mode." });
});

router.post("/2fa/setup", (_req, res) => {
  res.json({ message: "2FA is disabled in local mode." });
});

router.post("/2fa/verify", (_req, res) => {
  res.json({ message: "2FA is disabled in local mode." });
});

export default router;
