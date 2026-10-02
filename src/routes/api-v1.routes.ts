import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import prisma, { checkDatabase } from "../database/prisma";
import { ApiKeyService } from "../services/api-key.service";
import { requireApiKey } from "../middleware/auth.middleware";
import playlistRoutes from "./playlist.routes";
import channelLineupRoutes from "./channel-lineup.routes";
import settingsRoutes from "./settings.routes";
import epgRoutes from "./epg.routes";
import scheduleRoutes from "./schedule.routes";

const router = Router();

/**
 * GET /api/v1/health — public diagnostics (no API key) so we can always probe Synology.
 */
router.get("/health", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const projectRoot = path.resolve(__dirname, "../..");
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.1",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sqliteAdapter: "vendored node:sqlite (Node 22+ / 24+)",
    experimentalSqlite:
      process.execArgv.includes("--experimental-sqlite") ||
      (process.env.NODE_OPTIONS || "").includes("experimental-sqlite"),
    database: db,
    paths: {
      projectRoot,
      dataDir: path.join(projectRoot, "data"),
      dataDbExists: fs.existsSync(path.join(projectRoot, "data", "playlists.db")),
      legacyDbExists: fs.existsSync(path.join(projectRoot, "prisma", "dev.db")),
    },
    apiKey: {
      envConfigured: !!ApiKeyService.getEnvApiKey(),
    },
  });
});

/**
 * All other /api/v1/* routes require an API key.
 */
router.use(requireApiKey);

router.get("/diagnostics", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const apiKeyStatus = await ApiKeyService.getStatus();
  let playlistCount: number | null = null;
  let epgCount: number | null = null;
  let userCount: number | null = null;
  try {
    if (db.ok) {
      playlistCount = await prisma.playlist.count();
      epgCount = await prisma.epgFile.count();
      userCount = await prisma.user.count();
    }
  } catch (error: any) {
    // keep nulls
  }

  res.json({
    timestamp: new Date().toISOString(),
    node: process.version,
    sqliteAdapter: "vendored node:sqlite (Node 22+ / 24+)",
    database: db,
    counts: { playlists: playlistCount, epgFiles: epgCount, users: userCount },
    apiKey: apiKeyStatus,
  });
});

// Reuse existing route modules under /api/v1
router.use("/playlists", playlistRoutes);
router.use("/channel-lineup", channelLineupRoutes);
router.use("/settings", settingsRoutes);
router.use("/epg", epgRoutes);
router.use("/schedule", scheduleRoutes);

export default router;
