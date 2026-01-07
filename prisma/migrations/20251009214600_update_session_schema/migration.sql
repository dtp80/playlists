-- AlterTable: Update session table to match @quixo3/prisma-session-store requirements
-- Rename columns and add new ones

-- First, drop the existing primary key
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";

-- Rename columns
ALTER TABLE "session" RENAME COLUMN "sess" TO "data";
ALTER TABLE "session" RENAME COLUMN "expire" TO "expiresAt";

-- Add id column as the new primary key
ALTER TABLE "session" ADD COLUMN "id" TEXT;

-- Update id to be same as sid for existing rows
UPDATE "session" SET "id" = "sid";

-- Make id NOT NULL after setting values
ALTER TABLE "session" ALTER COLUMN "id" SET NOT NULL;

-- Add primary key on id
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("id");

-- Add unique constraint on sid
ALTER TABLE "session" ADD CONSTRAINT "session_sid_key" UNIQUE ("sid");

-- Drop old index and create new one
DROP INDEX IF EXISTS "session_expire_idx";
CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session"("expiresAt");

