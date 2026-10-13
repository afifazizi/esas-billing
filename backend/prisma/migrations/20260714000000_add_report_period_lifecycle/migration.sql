-- Additive Phase A lifecycle tables. No existing table or row is altered.
CREATE TABLE "report_period" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "custId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "lockedById" TEXT,
    "lockedAt" DATETIME,
    "reopenedById" TEXT,
    "reopenedAt" DATETIME,
    "reopenReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "report_period_custId_fkey" FOREIGN KEY ("custId") REFERENCES "customer" ("custId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "report_period_transition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportPeriodId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_period_transition_reportPeriodId_fkey" FOREIGN KEY ("reportPeriodId") REFERENCES "report_period" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "report_period_custId_month_year_key" ON "report_period"("custId", "month", "year");
CREATE INDEX "report_period_status_year_month_idx" ON "report_period"("status", "year", "month");
CREATE INDEX "report_period_transition_reportPeriodId_createdAt_idx" ON "report_period_transition"("reportPeriodId", "createdAt");
