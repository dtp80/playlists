-- CreateTable
CREATE TABLE IF NOT EXISTS "session" (
    "sid" TEXT NOT NULL,
    "sess" TEXT NOT NULL,
    "expire" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "session_expire_idx" ON "session"("expire");

