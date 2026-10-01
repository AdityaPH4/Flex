-- DropIndex
DROP INDEX "ReconciliationCode_code_key";

-- AlterTable: add nullable first so existing rows don't violate NOT NULL,
-- backfill from createdAt (the month each code was actually issued in),
-- then tighten to NOT NULL.
ALTER TABLE "ReconciliationCode" ADD COLUMN "periodKey" TEXT;

UPDATE "ReconciliationCode"
SET "periodKey" = to_char("createdAt", 'YYYY-MM')
WHERE "periodKey" IS NULL;

ALTER TABLE "ReconciliationCode" ALTER COLUMN "periodKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCode_code_periodKey_key" ON "ReconciliationCode"("code", "periodKey");
