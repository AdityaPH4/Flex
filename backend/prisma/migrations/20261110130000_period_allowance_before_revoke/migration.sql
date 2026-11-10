-- The month's allowance just before "Revoke balance", put back by "Undo revoke".
ALTER TABLE "BenefitPeriod" ADD COLUMN "allowanceBeforeRevoke" DECIMAL(10,2);
