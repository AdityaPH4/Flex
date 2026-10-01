-- CreateTable
-- This table's original creation was never captured as a tracked migration
-- (it was created ad hoc against the dev database outside the migration
-- history) - added here, at the point this migration history first
-- references it, so the full history can be replayed from scratch onto a
-- fresh database. Matches the actual live structure of the table as it has
-- existed in the dev database all along.
CREATE TABLE "ReconciliationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'Benefit redemption',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCode_code_key" ON "ReconciliationCode"("code");

-- CreateIndex
CREATE INDEX "ReconciliationCode_employeeId_idx" ON "ReconciliationCode"("employeeId");

-- CreateIndex
CREATE INDEX "ReconciliationCode_createdAt_idx" ON "ReconciliationCode"("createdAt");

-- AddForeignKey
ALTER TABLE "ReconciliationCode" ADD CONSTRAINT "ReconciliationCode_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ReconciliationCode" ADD COLUMN     "transactionId" TEXT;

-- AddForeignKey
ALTER TABLE "ReconciliationCode" ADD CONSTRAINT "ReconciliationCode_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BenefitTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
