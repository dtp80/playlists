#!/usr/bin/env node
/**
 * Native module check for Synology installs (pm2-gui often uses
 * `pnpm install --ignore-scripts`).
 *
 * Playlists Manager uses Node's built-in `node:sqlite` (via prisma-adapter-sqlite),
 * so there is no better-sqlite3 binary to fetch. This script only verifies that
 * `node:sqlite` can be loaded — matching EPG Handler's Synology approach.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  require("node:sqlite");
  console.log("[playlists] node:sqlite available");
} catch (err) {
  console.error(
    "[playlists] node:sqlite is not available in this Node build.",
    "Use Node.js 22.5+ with --experimental-sqlite (see ecosystem.config.cjs),",
    "or Node.js 24+."
  );
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

console.log("[playlists] native ensure complete (no better-sqlite3 required)");
