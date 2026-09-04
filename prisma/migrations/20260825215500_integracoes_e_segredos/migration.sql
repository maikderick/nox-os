-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DESLIGADO',
    "enabledById" TEXT,
    "enabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("organizationId","provider")
);

-- CreateTable
CREATE TABLE "SecretRef" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PLATAFORMA',
    "organizationId" TEXT,
    "purpose" TEXT NOT NULL,
    "envVarName" TEXT NOT NULL,
    "fingerprint" TEXT,
    "lastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSetting_provider_mode_idx" ON "IntegrationSetting"("provider", "mode");

-- CreateIndex
CREATE INDEX "SecretRef_purpose_idx" ON "SecretRef"("purpose");

-- CreateIndex
CREATE UNIQUE INDEX "SecretRef_scope_organizationId_purpose_key" ON "SecretRef"("scope", "organizationId", "purpose");

-- AddForeignKey
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_enabledById_fkey" FOREIGN KEY ("enabledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretRef" ADD CONSTRAINT "SecretRef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

