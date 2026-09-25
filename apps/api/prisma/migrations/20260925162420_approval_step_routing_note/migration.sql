-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "routing_note" TEXT;

-- AlterTable
ALTER TABLE "contracts" ALTER COLUMN "reference_number" SET DEFAULT ('CTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_reference_seq')::text, 5, '0'));
