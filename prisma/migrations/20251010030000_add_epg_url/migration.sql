-- Add EPG URL field to User table for importing channel lineup from XMLTV files
ALTER TABLE "users" ADD COLUMN "epgUrl" TEXT;

