import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
const session = require("express-session");
import playlistRoutes from "./routes/playlist.routes";
import channelLineupRoutes from "./routes/channel-lineup.routes";
import settingsRoutes from "./routes/settings.routes";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import epgRoutes from "./routes/epg.routes";
import publicPlaylistRoutes from "./routes/public-playlist.routes";
import scheduleRoutes from "./routes/schedule.routes";
import { PlaylistSyncJobService } from "./services/playlist-sync-job.service";
import prisma from "./database/prisma";
import { requireAuth } from "./middleware/auth.middleware";
import { initDB } from "./database/prisma";

// Load environment variables
dotenv.config();

// Initialize database for local usage
initDB().catch((error) => {
  console.error("Failed to initialize database:", error);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
// Raise body limits to accommodate JSON imports/exports (EPG/channel mappings)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Lightweight in-memory session (no external DB dependency)
app.use(
  session({
    name: "localSession",
    secret: process.env.SESSION_SECRET || "local-dev-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// Inject default admin user into the session so the rest of the code can reuse the same paths
app.use((req, _res, next) => {
  const sess: any = req.session || {};
  if (!sess.user) {
    sess.user = {
      id: 1,
      email: "admin@localhost",
      role: "ADMIN",
      twoFactorEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (req as any).session = sess;
  }
  next();
});

// Public API Routes (no auth required)
app.use("/api/auth", authRoutes);

// Public playlist access (no auth required, uses credentials in query params)
app.use("/playlist", publicPlaylistRoutes);

// Health check (no auth required)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes (auth is disabled; middleware injects default admin)
app.use("/api/playlists", requireAuth, playlistRoutes);
app.use("/api/channel-lineup", requireAuth, channelLineupRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/epg", requireAuth, epgRoutes);
app.use("/api/schedule", requireAuth, scheduleRoutes);

// Serve static files from client build in production
const clientBuildPath = path.join(__dirname, "../client/dist");
app.use(express.static(clientBuildPath));

// Serve index.html for all other routes (SPA support)
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
);

// Start server locally
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
});

// Simple in-process scheduler for channel syncs (local-only)
const scheduleState = {
  running: false,
  lastMinute: "",
};

const loadScheduleConfig = async () => {
  const setting = await prisma.setting.findUnique({
    where: { key: "syncSchedule" },
  });
  if (!setting?.value) return [];
  try {
    const parsed = JSON.parse(setting.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const runScheduledSync = async (playlistId: number) => {
  try {
    const jobId = await PlaylistSyncJobService.createJob(1, playlistId);
    let done = false;
    while (!done) {
      done = await PlaylistSyncJobService.processSyncChunk(jobId, 7000);
    }
  } catch (err: any) {
    console.error(`[Scheduler] Sync failed for playlist ${playlistId}:`, err.message);
  }
};

const scheduleTick = async () => {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM

  if (scheduleState.running || scheduleState.lastMinute === minuteKey) {
    return;
  }

  const schedule = await loadScheduleConfig();
  const due = schedule
    .filter((item: any) => item?.enabled && item?.time === currentTime)
    .sort((a: any, b: any) => (a.playlistId || 0) - (b.playlistId || 0));

  if (due.length === 0) {
    return;
  }

  scheduleState.running = true;
  scheduleState.lastMinute = minuteKey;

  for (const item of due) {
    if (!item?.playlistId) continue;
    await runScheduledSync(item.playlistId);
  }

  scheduleState.running = false;
};

// Check schedule every 20 seconds
setInterval(scheduleTick, 20000);

export default app;
