-- The RedemptionToken system was replaced by the Digitory ReconciliationCode
-- hand-off flow (see ReconciliationCode model comment / CLAUDE.md item 1).
-- This drop was applied ad hoc against the dev database at the time and was
-- never captured as a tracked migration - added now so replaying the full
-- migration history from scratch matches the dev database's actual live
-- schema exactly.

-- DropForeignKey
ALTER TABLE "BenefitTransaction" DROP CONSTRAINT "BenefitTransaction_redemptionTokenId_fkey";

-- DropForeignKey
ALTER TABLE "RedemptionToken" DROP CONSTRAINT "RedemptionToken_employeeId_fkey";

-- DropIndex
DROP INDEX "BenefitTransaction_redemptionTokenId_key";

-- AlterTable
ALTER TABLE "BenefitTransaction" DROP COLUMN "redemptionTokenId";

-- DropTable
DROP TABLE "RedemptionToken";
