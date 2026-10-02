import { defineConfig } from "@prisma/config";
import "dotenv/config";

// Prisma 7 configuration (aligned with dikotest / arnisales).
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./data/playlists.db",
  },
});
