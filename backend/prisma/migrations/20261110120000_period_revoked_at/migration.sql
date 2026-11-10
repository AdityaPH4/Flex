-- When the admin last revoked this month's balance (Employees tab "Revoked balance" list).
ALTER TABLE "BenefitPeriod" ADD COLUMN "revokedAt" TIMESTAMP(3);
