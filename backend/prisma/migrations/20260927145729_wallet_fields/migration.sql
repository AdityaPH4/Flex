-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "dateOfJoining" TIMESTAMP(3),
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "otpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "walletLimit" INTEGER,
ADD COLUMN     "walletValidFrom" TIMESTAMP(3),
ADD COLUMN     "walletValidTo" TIMESTAMP(3);
