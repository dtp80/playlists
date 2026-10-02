#!/usr/bin/env node
/**
 * Generate Prisma client into src/generated/prisma (vendored for Synology).
 *
 * On Synology, Prisma's schema-engine often SIGSEGVs under Node.js Package Center
 * builds. Prefer the vendored client: skip generate when it already exists unless
 * FORCE_PRISMA_GENERATE=1.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const requireFromRoot = createRequire(
  pathToFileURL(path.join(root, "package.json")).href
);
const clientDir = path.join(root, "src", "generated", "prisma");
const clientMarkers = [
  path.join(clientDir, "client.js"),
  path.join(clientDir, "client.ts"),
  path.join(clientDir, "index.js"),
];
const force =
  process.env.FORCE_PRISMA_GENERATE === "1" || process.argv.includes("--force");

const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = "file:./prisma/dev.db";
  console.warn(
    "[playlists] DATABASE_URL unset during generate — using file:./prisma/dev.db"
  );
}

const schemaPath = path.join(root, "prisma", "schema.prisma");
if (!existsSync(schemaPath)) {
  console.error("[playlists] schema not found at", schemaPath);
  process.exit(1);
}

function hasVendoredClient() {
  return clientMarkers.some((marker) => existsSync(marker));
}

if (!force && hasVendoredClient()) {
  console.log(
    "[playlists] using vendored Prisma client at src/generated/prisma (skip generate)."
  );
  console.log(
    "[playlists] set FORCE_PRISMA_GENERATE=1 or pass --force after schema changes."
  );
  process.exit(0);
}

function resolvePrismaCli() {
  try {
    const pkgJson = requireFromRoot.resolve("prisma/package.json");
    const pkg = requireFromRoot(pkgJson);
    const binRel =
      (pkg &&
        pkg.bin &&
        (typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma)) ||
      "build/index.js";
    const cli = path.join(path.dirname(pkgJson), binRel);
    if (existsSync(cli)) return cli;
  } catch (err) {
    console.warn(
      "[playlists] require.resolve(prisma) failed:",
      err instanceof Error ? err.message : err
    );
  }

  const fallbacks = [
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    path.join(root, "node_modules", "prisma", "build", "index.cjs"),
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }

  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (!entry.startsWith("prisma@")) continue;
        const cli = path.join(
          pnpmDir,
          entry,
          "node_modules",
          "prisma",
          "build",
          "index.js"
        );
        if (existsSync(cli)) return cli;
      }
    } catch (err) {}
  }

  return null;
}

const prismaCli = resolvePrismaCli();
if (!prismaCli) {
  if (hasVendoredClient()) {
    console.warn(
      "[playlists] Prisma CLI missing — continuing with vendored client"
    );
    process.exit(0);
  }
  console.error(
    "[playlists] Prisma CLI not found under node_modules (is prisma in dependencies?)"
  );
  process.exit(1);
}

console.log("[playlists] generating Prisma client via", prismaCli);
console.log("[playlists] node", process.version, "execPath", process.execPath);
console.log("[playlists] output", clientDir);

const result = spawnSync(
  process.execPath,
  [prismaCli, "generate", "--schema", schemaPath],
  {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

function exitWithVendoredFallback(message) {
  if (hasVendoredClient()) {
    console.warn("[playlists]", message, "— using vendored client");
    process.exit(0);
  }
  console.error("[playlists]", message);
  process.exit(1);
}

if (result.error) {
  exitWithVendoredFallback("generate spawn failed: " + result.error.message);
}

if (result.signal) {
  exitWithVendoredFallback("prisma generate killed by signal " + result.signal);
}

if (result.status !== 0) {
  exitWithVendoredFallback(
    "prisma generate failed (exit " + String(result.status) + ")"
  );
}

console.log("[playlists] prisma generate ok →", clientDir);
