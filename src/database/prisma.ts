import "dotenv/config";
import fs from "fs";
import path from "path";
import type { PrismaClient as PrismaClientType } from "../generated/prisma/client";
import { PrismaClient } from "../generated/prisma/client";
import bcrypt from "bcryptjs";
import { SQLITE_BOOTSTRAP_SQL } from "./sqlite-bootstrap-sql";

const projectRoot = path.resolve(__dirname, "../..");

// Vendored node:sqlite adapter (Node 22 + --experimental-sqlite on Synology).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaSqlite } = require(path.join(
  projectRoot,
  "vendor/prisma-sqlite-adapter.cjs"
)) as {
  PrismaSqlite: new (config: { url: string }) => any;
};

function loadNodeSqlite(): {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean }
  ) => {
    prepare: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
    exec: (sql: string) => void;
    close: () => void;
  };
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:sqlite");
}

function absolutePathFromFileUrl(fileUrl: string): string {
  const normalized = fileUrl.startsWith("file://")
    ? fileUrl
    : fileUrl.replace(/^file:/, "file://");
  const u = new URL(normalized);
  let p = decodeURIComponent(u.pathname);
  // Windows file URLs look like /C:/...
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return p;
}

function resolveTargetDbPath(): string {
  const preferredDb = path.join(projectRoot, "data", "playlists.db");
  const envUrl = process.env.DATABASE_URL?.trim();
  if (!envUrl) return preferredDb;

  if (envUrl.startsWith("file:")) {
    const rest = envUrl.slice("file:".length);
    // file:///abs/path or file://localhost/abs/path
    if (rest.startsWith("//")) {
      return absolutePathFromFileUrl(envUrl);
    }
    // file:/abs/path (single slash)
    if (rest.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rest)) {
      return path.normalize(rest);
    }
    // Relative: file:./data/playlists.db (ecosystem.config.cjs)
    return path.resolve(projectRoot, rest);
  }
  if (path.isAbsolute(envUrl)) return envUrl;
  return path.resolve(projectRoot, envUrl);
}

/**
 * Adapter expects `file:` + filesystem path. Using pathToFileURL produces
 * `file:///abs` which naive adapters turn into `///abs` and open an empty DB.
 */
function toAdapterUrl(dbPath: string): string {
  return `file:${dbPath}`;
}

function sqliteHasTable(dbPath: string, table: string): boolean {
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return false;
  try {
    const { DatabaseSync } = loadNodeSqlite();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(table) as { ok?: number } | undefined;
    db.close();
    return !!row?.ok;
  } catch (err) {
    console.warn(
      `[Prisma] sqliteHasTable(${table}) failed for ${dbPath}:`,
      (err as Error)?.message || err
    );
    return false;
  }
}

function copySqliteFile(fromPath: string, toPath: string) {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  // Avoid leaving stale WAL beside a replaced DB
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const dest = `${toPath}${suffix}`;
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  }
  fs.copyFileSync(fromPath, toPath);
  for (const suffix of ["-wal", "-shm"]) {
    const src = `${fromPath}${suffix}`;
    if (fs.existsSync(src)) fs.copyFileSync(src, `${toPath}${suffix}`);
  }
}

function removeSqliteFiles(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const dest = `${dbPath}${suffix}`;
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  }
}

function readBootstrapSql(): string {
  const diskPath = path.join(projectRoot, "prisma", "sqlite-bootstrap.sql");
  if (fs.existsSync(diskPath)) {
    return fs.readFileSync(diskPath, "utf8");
  }
  return SQLITE_BOOTSTRAP_SQL;
}

/**
 * Ensure the SQLite file exists and has Prisma tables.
 * Synology often ends up with an empty data/playlists.db because the file was
 * created before `prisma db push` could run (schema engines crash there).
 */
function ensureSqliteDatabase(dbPath: string): {
  path: string;
  action: "ready" | "copied-legacy" | "bootstrapped";
} {
  const legacyDb = path.join(projectRoot, "prisma", "dev.db");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (sqliteHasTable(dbPath, "settings")) {
    console.log(`[Prisma] SQLite ready at ${dbPath}`);
    return { path: dbPath, action: "ready" };
  }

  console.warn(
    `[Prisma] settings table missing in ${dbPath} (exists=${fs.existsSync(dbPath)}, size=${
      fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
    }) — repairing…`
  );

  if (sqliteHasTable(legacyDb, "settings")) {
    copySqliteFile(legacyDb, dbPath);
    console.log(
      `[Prisma] Copied schema+data from prisma/dev.db → ${dbPath}`
    );
    return { path: dbPath, action: "copied-legacy" };
  }

  const { DatabaseSync } = loadNodeSqlite();
  removeSqliteFiles(dbPath);

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(readBootstrapSql());
  } finally {
    db.close();
  }

  if (!sqliteHasTable(dbPath, "settings")) {
    throw new Error(
      `[Prisma] Bootstrap ran but settings table still missing at ${dbPath}`
    );
  }

  console.log(`[Prisma] Bootstrapped empty SQLite schema at ${dbPath}`);
  return { path: dbPath, action: "bootstrapped" };
}

const dbPath = (() => {
  fs.mkdirSync(path.join(projectRoot, "data"), { recursive: true });
  return ensureSqliteDatabase(resolveTargetDbPath()).path;
})();
const dbUrl = toAdapterUrl(dbPath);
// eslint-disable-next-line no-console
console.log(
  "[Prisma] Using vendored node:sqlite adapter (Node 22+/24+), path:",
  dbPath,
  "url:",
  dbUrl
);

const globalForPrisma = global as unknown as { prisma: PrismaClientType };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaSqlite({ url: dbUrl }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Lightweight DB probe for /api/health and startup diagnostics */
export const checkDatabase = async (): Promise<{
  ok: boolean;
  url: string;
  path?: string;
  error?: string;
  hasSettingsTable?: boolean;
}> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      url: dbUrl,
      path: dbPath,
      hasSettingsTable: sqliteHasTable(dbPath, "settings"),
    };
  } catch (error: any) {
    return {
      ok: false,
      url: dbUrl,
      path: dbPath,
      error: error?.message || String(error),
      hasSettingsTable: sqliteHasTable(dbPath, "settings"),
    };
  }
};

export const initDB = async () => {
  try {
    const probe = await checkDatabase();
    if (!probe.ok) {
      console.error("❌ Database not reachable:", probe.error);
      console.error(
        "   On Synology/Node 22, ensure PM2 uses --experimental-sqlite",
        "(see ecosystem.config.cjs)."
      );
      return;
    }

    if (!probe.hasSettingsTable) {
      console.error(
        "❌ Database file is reachable but settings table is missing after bootstrap."
      );
      return;
    }

    const debugModeSetting = await prisma.setting.findUnique({
      where: { key: "debugMode" },
    });

    if (!debugModeSetting) {
      await prisma.setting.create({
        data: {
          key: "debugMode",
          value: "1",
        },
      });
      console.log("✅ Created default debugMode setting");
    }

    const bypass2FASetting = await prisma.setting.findUnique({
      where: { key: "bypass2FA" },
    });

    if (!bypass2FASetting) {
      await prisma.setting.create({
        data: {
          key: "bypass2FA",
          value: "0",
        },
      });
      console.log("✅ Created default bypass2FA setting");
    }

    const syncTimeoutSetting = await prisma.setting.findUnique({
      where: { key: "syncTimeout" },
    });

    if (!syncTimeoutSetting) {
      await prisma.setting.create({
        data: {
          key: "syncTimeout",
          value: "60",
        },
      });
      console.log("✅ Created default syncTimeout setting");
    }

    const existingAdmin = await prisma.user.findUnique({
      where: { email: "admin@home.local" },
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await prisma.user.create({
        data: {
          email: "admin@home.local",
          password: hashedPassword,
          role: "ADMIN",
          twoFactorEnabled: 0,
        },
      });
      console.log("✅ Admin user seeded: admin@home.local / admin123");
    }

    console.log("✅ Database ready");
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
  }
};

export const isDebugMode = async (): Promise<boolean> => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "debugMode" },
    });
    return setting?.value === "1";
  } catch (e) {
    return false;
  }
};

export const isBypass2FAEnabled = async (): Promise<boolean> => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "bypass2FA" },
    });
    return setting?.value === "1";
  } catch (e) {
    return false;
  }
};

export const getSyncTimeout = async (): Promise<number> => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "syncTimeout" },
    });
    const timeoutSeconds = parseInt(setting?.value || "60", 10);
    return timeoutSeconds * 1000;
  } catch (e) {
    return 60000;
  }
};

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export default prisma;
