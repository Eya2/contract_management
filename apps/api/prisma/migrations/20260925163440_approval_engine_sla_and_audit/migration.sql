-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_STEP_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_STEP_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTRACT_REOPENED';

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "sla_hours" INTEGER;

-- AlterTable
ALTER TABLE "contracts" ALTER COLUMN "reference_number" SET DEFAULT ('CTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_reference_seq')::text, 5, '0'));
