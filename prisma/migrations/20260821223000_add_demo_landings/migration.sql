-- CreateTable
CREATE TABLE "DemoLanding" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contentJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoLanding_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "DemoLanding" ADD CONSTRAINT "DemoLanding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoLanding" ADD CONSTRAINT "DemoLanding_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
