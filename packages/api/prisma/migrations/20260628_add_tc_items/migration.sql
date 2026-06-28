-- CreateTable: TC Library items (requirement-level test cases imported from Excel)
CREATE TABLE "TcItem" (
    "id"             TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    "srNo"           INTEGER,
    "module"         TEXT,
    "feature"        TEXT,
    "title"          TEXT NOT NULL,
    "description"    TEXT,
    "steps"          TEXT,
    "expectedResult" TEXT,
    "linkedScriptId" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TcItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TcItem_projectId_idx" ON "TcItem"("projectId");
CREATE INDEX "TcItem_linkedScriptId_idx" ON "TcItem"("linkedScriptId");

-- AddForeignKey
ALTER TABLE "TcItem" ADD CONSTRAINT "TcItem_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TcItem" ADD CONSTRAINT "TcItem_linkedScriptId_fkey"
    FOREIGN KEY ("linkedScriptId") REFERENCES "TestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
