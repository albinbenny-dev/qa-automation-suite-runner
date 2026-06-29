-- Add index on Run.createdByUserId for checkRunRateLimit query performance
CREATE INDEX IF NOT EXISTS "Run_createdByUserId_idx" ON "Run"("createdByUserId");

-- Add index on RunResult.scriptId for script DELETE cascade query performance
CREATE INDEX IF NOT EXISTS "RunResult_scriptId_idx" ON "RunResult"("scriptId");
