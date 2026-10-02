import crypto from "crypto";
import prisma from "../database/prisma";

const SETTINGS_KEY = "apiKey";

function extractHeaderKey(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const rawKey = req.headers["x-api-key"];
  if (typeof rawKey === "string" && rawKey.trim()) {
    return rawKey.trim();
  }
  if (Array.isArray(rawKey) && rawKey[0]?.trim()) {
    return rawKey[0].trim();
  }

  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export class ApiKeyService {
  static extractFromRequest(req: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    return extractHeaderKey(req);
  }

  static getEnvApiKey(): string | null {
    const key = process.env.API_KEY?.trim();
    return key || null;
  }

  static async getStoredApiKey(): Promise<string | null> {
    try {
      const row = await prisma.setting.findUnique({
        where: { key: SETTINGS_KEY },
      });
      const value = row?.value?.trim();
      return value || null;
    } catch {
      // DB may be unavailable during Synology bootstrap
      return null;
    }
  }

  static async isValid(key: string | null | undefined): Promise<boolean> {
    if (!key) return false;
    const envKey = this.getEnvApiKey();
    if (envKey && key === envKey) return true;
    const stored = await this.getStoredApiKey();
    return !!(stored && key === stored);
  }

  static mask(key: string | null): string | null {
    if (!key) return null;
    if (key.length <= 8) return "••••••••";
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
  }

  static generate(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  static async getStatus(): Promise<{
    configured: boolean;
    source: "env" | "database" | "both" | "none";
    maskedKey: string | null;
    envConfigured: boolean;
    databaseConfigured: boolean;
  }> {
    const envKey = this.getEnvApiKey();
    const stored = await this.getStoredApiKey();
    const envConfigured = !!envKey;
    const databaseConfigured = !!stored;
    let source: "env" | "database" | "both" | "none" = "none";
    if (envConfigured && databaseConfigured) source = "both";
    else if (envConfigured) source = "env";
    else if (databaseConfigured) source = "database";

    return {
      configured: envConfigured || databaseConfigured,
      source,
      maskedKey: this.mask(envKey || stored),
      envConfigured,
      databaseConfigured,
    };
  }

  static async save(key: string): Promise<void> {
    await prisma.setting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: key, updatedAt: new Date() },
      create: { key: SETTINGS_KEY, value: key },
    });
  }

  static async clearStored(): Promise<void> {
    try {
      await prisma.setting.delete({ where: { key: SETTINGS_KEY } });
    } catch {
      // ignore missing
    }
  }
}
