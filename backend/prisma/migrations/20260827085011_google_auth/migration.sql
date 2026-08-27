-- DropForeignKey
ALTER TABLE "OtpRequest" DROP CONSTRAINT "OtpRequest_employeeId_fkey";

-- DropIndex
DROP INDEX "Employee_phone_idx";

-- DropIndex
DROP INDEX "Employee_phone_key";

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "email" TEXT NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;

-- DropTable
DROP TABLE "OtpRequest";

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
