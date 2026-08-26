-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteProjectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "installationId" TEXT,
    "protectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostingProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteProjectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'vercel',
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostingProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteProvisioning" (
    "id" TEXT NOT NULL,
    "siteProjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "lastStep" TEXT,
    "lastError" TEXT,
    "contentSha256" TEXT,
    "commitSha" TEXT,
    "previewUrl" TEXT,
    "previewExternalId" TEXT,
    "previewCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteProvisioning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_siteProjectId_key" ON "Repository"("siteProjectId");

-- CreateIndex
CREATE INDEX "Repository_organizationId_idx" ON "Repository"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_provider_owner_name_key" ON "Repository"("provider", "owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HostingProject_siteProjectId_key" ON "HostingProject"("siteProjectId");

-- CreateIndex
CREATE INDEX "HostingProject_organizationId_idx" ON "HostingProject"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteProvisioning_siteProjectId_key" ON "SiteProvisioning"("siteProjectId");

-- CreateIndex
CREATE INDEX "SiteProvisioning_status_idx" ON "SiteProvisioning"("status");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_siteProjectId_fkey" FOREIGN KEY ("siteProjectId") REFERENCES "SiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostingProject" ADD CONSTRAINT "HostingProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostingProject" ADD CONSTRAINT "HostingProject_siteProjectId_fkey" FOREIGN KEY ("siteProjectId") REFERENCES "SiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProvisioning" ADD CONSTRAINT "SiteProvisioning_siteProjectId_fkey" FOREIGN KEY ("siteProjectId") REFERENCES "SiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

