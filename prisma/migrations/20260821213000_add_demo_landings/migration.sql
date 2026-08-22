-- CreateTable
CREATE TABLE "DemoLanding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'APPROVED', 'EXPIRED')),
    "contentJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DemoLanding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemoLanding_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoLanding_businessId_key" ON "DemoLanding"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoLanding_slug_key" ON "DemoLanding"("slug");

-- CreateIndex
CREATE INDEX "DemoLanding_status_idx" ON "DemoLanding"("status");

-- CreateIndex
CREATE INDEX "DemoLanding_expiresAt_idx" ON "DemoLanding"("expiresAt");

-- CreateIndex
CREATE INDEX "DemoLanding_createdById_idx" ON "DemoLanding"("createdById");
