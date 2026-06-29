-- Convert srNo from Int to String to support alphanumeric IDs (e.g. AIR-TC-001)
ALTER TABLE "TcItem" ALTER COLUMN "srNo" TYPE TEXT USING "srNo"::TEXT;

-- Add automationStatus field: IN_SCOPE (default) | NOT_APPLICABLE
ALTER TABLE "TcItem" ADD COLUMN "automationStatus" TEXT NOT NULL DEFAULT 'IN_SCOPE';

-- Index for fast filtering by automationStatus per project
CREATE INDEX "TcItem_projectId_automationStatus_idx" ON "TcItem"("projectId", "automationStatus");
