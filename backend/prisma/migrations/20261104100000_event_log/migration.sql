-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "employeeId" TEXT,
    "event" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "error" TEXT,
    "detail" JSONB,
    "ip" TEXT,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_at_idx" ON "EventLog"("at");

-- CreateIndex
CREATE INDEX "EventLog_employeeId_at_idx" ON "EventLog"("employeeId", "at");

