import { Router, Request, Response } from "express";
import prisma from "../database/prisma";
import { requireAdmin } from "../middleware/auth.middleware";

const router = Router();

/**
 * GET /api/settings - Get all settings
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany();

    // Convert to key-value object
    const settingsObj: Record<string, any> = {};
    settings.forEach((setting) => {
      // Convert boolean settings
      if (setting.key === "debugMode" || setting.key === "bypass2FA") {
        settingsObj[setting.key] = setting.value === "1";
      } else if (setting.key === "syncTimeout") {
        // Convert to number with default of 60 seconds
        settingsObj[setting.key] = parseInt(setting.value || "60", 10);
      } else {
        settingsObj[setting.key] = setting.value;
      }
    });

    // Set default for syncTimeout if not present
    if (!settingsObj.syncTimeout) {
      settingsObj.syncTimeout = 60;
    }

    res.json(settingsObj);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings - Update settings
 */
router.put("/", async (req: Request, res: Response) => {
  try {
    const { debugMode, bypass2FA, syncTimeout } = req.body;

    if (debugMode !== undefined) {
      const value = debugMode ? "1" : "0";
      await prisma.setting.upsert({
        where: { key: "debugMode" },
        update: { value, updatedAt: new Date() },
        create: { key: "debugMode", value },
      });
    }

    // bypass2FA can only be updated by admins
    if (bypass2FA !== undefined) {
      // This check is done in middleware, but adding explicit check for safety
      const session = req.session as any;
      if (session.user?.role !== "Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const value = bypass2FA ? "1" : "0";
      await prisma.setting.upsert({
        where: { key: "bypass2FA" },
        update: { value, updatedAt: new Date() },
        create: { key: "bypass2FA", value },
      });
    }

    // syncTimeout can only be updated by admins
    if (syncTimeout !== undefined) {
      const session = req.session as any;
      if (session.user?.role !== "Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      // Validate timeout (between 10 and 300 seconds)
      const timeoutValue = parseInt(syncTimeout, 10);
      if (isNaN(timeoutValue) || timeoutValue < 10 || timeoutValue > 300) {
        return res.status(400).json({
          error: "Sync timeout must be between 10 and 300 seconds",
        });
      }

      await prisma.setting.upsert({
        where: { key: "syncTimeout" },
        update: { value: String(timeoutValue), updatedAt: new Date() },
        create: { key: "syncTimeout", value: String(timeoutValue) },
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
