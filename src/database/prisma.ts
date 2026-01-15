import "dotenv/config";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcrypt";

// Ensure datasource URL is available at runtime (Prisma 7 expects env-based URL)
const dbUrl = process.env.DATABASE_URL || "file:./dev.db";
// Debug: ensure engine info
// eslint-disable-next-line no-console
console.log("[Prisma] Using adapter better-sqlite3, url:", dbUrl);

// Local-first Prisma client (SQLite file by default)
const globalForPrisma = global as unknown as { prisma: PrismaClientType };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: dbUrl }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Initialize database (seed default settings and admin user if needed)
export const initDB = async () => {
  try {
    // Check if default settings exist, if not create them
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

    // Check if admin user exists, if not create one
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
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
  }
};

// Helper function to get debug mode status
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

// Helper function to get bypass 2FA status
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

// Helper function to get sync timeout in milliseconds
export const getSyncTimeout = async (): Promise<number> => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "syncTimeout" },
    });
    const timeoutSeconds = parseInt(setting?.value || "60", 10);
    return timeoutSeconds * 1000; // Convert to milliseconds
  } catch (e) {
    return 60000; // Default 60 seconds in milliseconds
  }
};

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export default prisma;
