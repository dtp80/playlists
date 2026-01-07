-- Add isDefault column to epg_files
ALTER TABLE "epg_files" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Set the first EPG file (lowest id) for each user as default
UPDATE "epg_files" e1
SET "isDefault" = true
WHERE e1.id IN (
  SELECT MIN(e2.id)
  FROM "epg_files" e2
  WHERE e2."userId" = e1."userId"
  GROUP BY e2."userId"
);

-- Drop the sortOrder column (no longer needed)
DROP INDEX IF EXISTS "epg_files_sortOrder_idx";
ALTER TABLE "epg_files" DROP COLUMN IF EXISTS "sortOrder";

