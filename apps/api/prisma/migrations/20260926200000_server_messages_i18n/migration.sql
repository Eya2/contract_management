-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" VARCHAR(5) NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "body_msg" JSONB,
ADD COLUMN     "title_msg" JSONB;

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "routing_note_msg" JSONB,
ADD COLUMN     "skip_reason_msg" JSONB;

-- AlterTable
ALTER TABLE "contract_status_changes" ADD COLUMN     "reason_msg" JSONB;
