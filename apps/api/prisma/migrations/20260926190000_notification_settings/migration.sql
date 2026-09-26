-- AlterTable
ALTER TABLE "users" ADD COLUMN     "daily_digest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_digest_on" DATE,
ADD COLUMN     "notification_prefs" JSONB NOT NULL DEFAULT '{}';
