-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "address" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "phoneRaw" TEXT,
    "phoneE164" TEXT,
    "website" TEXT,
    "websiteStatus" TEXT NOT NULL DEFAULT 'unknown',
    "socialLinks" TEXT NOT NULL DEFAULT '[]',
    "sourceUrl" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "scoreReasons" TEXT NOT NULL DEFAULT '[]',
    "funnelStage" TEXT NOT NULL DEFAULT 'novo',
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notesText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSource" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" TEXT,

    CONSTRAINT "BusinessSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "originLabel" TEXT,
    "radiiKm" TEXT NOT NULL DEFAULT '[5,10,20,40,80]',
    "currentRadiusKm" DOUBLE PRECISION,
    "categories" TEXT NOT NULL DEFAULT '[]',
    "progressJson" TEXT NOT NULL DEFAULT '{}',
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreResult" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "breakdownJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "optInStatus" TEXT NOT NULL DEFAULT 'unknown',
    "source" TEXT,
    "purpose" TEXT,
    "evidence" TEXT,
    "optedInAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "messagePreview" TEXT,
    "confirmedSent" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "phoneE164" TEXT,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "brandName" TEXT NOT NULL DEFAULT 'NOX OS',
    "sellerName" TEXT NOT NULL DEFAULT '[SEU NOME]',
    "defaultCity" TEXT NOT NULL DEFAULT '[SUA CIDADE/UF]',
    "leadGoal" INTEGER NOT NULL DEFAULT 1000,
    "initialRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "maxRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "privacyEmail" TEXT NOT NULL DEFAULT '[SEU E-MAIL]',
    "portfolioUrl" TEXT NOT NULL DEFAULT '[URL DO PORTFÓLIO]',
    "whatsappPhone" TEXT NOT NULL DEFAULT '[SEU WHATSAPP]',
    "whatsappTemplate" TEXT NOT NULL DEFAULT 'Olá, equipe da {{businessName}}! Sou {{sellerName}}, da NOX OS. Conforme sua autorização para contato, gostaria de apresentar uma ideia de site personalizado para fortalecer a presença digital da empresa e gerar mais contatos. Posso te enviar uma proposta inicial sem compromisso? Se preferir não receber novas mensagens, é só me avisar.',
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "originLabel" TEXT,
    "franchisePenalty" INTEGER NOT NULL DEFAULT 15,
    "modernSitePenalty" INTEGER NOT NULL DEFAULT 20,
    "staleDataPenalty" INTEGER NOT NULL DEFAULT 10,
    "enabledCategories" TEXT NOT NULL DEFAULT '[]',
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Business_city_idx" ON "Business"("city");

-- CreateIndex
CREATE INDEX "Business_category_idx" ON "Business"("category");

-- CreateIndex
CREATE INDEX "Business_opportunityScore_idx" ON "Business"("opportunityScore");

-- CreateIndex
CREATE INDEX "Business_funnelStage_idx" ON "Business"("funnelStage");

-- CreateIndex
CREATE INDEX "Business_phoneE164_idx" ON "Business"("phoneE164");

-- CreateIndex
CREATE INDEX "Business_nameNormalized_idx" ON "Business"("nameNormalized");

-- CreateIndex
CREATE INDEX "Business_distanceKm_idx" ON "Business"("distanceKm");

-- CreateIndex
CREATE INDEX "Business_doNotContact_idx" ON "Business"("doNotContact");

-- CreateIndex
CREATE INDEX "Business_isDemo_idx" ON "Business"("isDemo");

-- CreateIndex
CREATE INDEX "Business_lastVerifiedAt_idx" ON "Business"("lastVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Business_source_externalId_key" ON "Business"("source", "externalId");

-- CreateIndex
CREATE INDEX "BusinessSource_businessId_idx" ON "BusinessSource"("businessId");

-- CreateIndex
CREATE INDEX "BusinessSource_source_externalId_idx" ON "BusinessSource"("source", "externalId");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ScoreResult_businessId_idx" ON "ScoreResult"("businessId");

-- CreateIndex
CREATE INDEX "ConsentRecord_businessId_idx" ON "ConsentRecord"("businessId");

-- CreateIndex
CREATE INDEX "ConsentRecord_optInStatus_idx" ON "ConsentRecord"("optInStatus");

-- CreateIndex
CREATE INDEX "ContactAttempt_businessId_idx" ON "ContactAttempt"("businessId");

-- CreateIndex
CREATE INDEX "Note_businessId_idx" ON "Note"("businessId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_phoneE164_idx" ON "SuppressionEntry"("phoneE164");

-- CreateIndex
CREATE INDEX "SuppressionEntry_businessId_idx" ON "SuppressionEntry"("businessId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "BusinessSource" ADD CONSTRAINT "BusinessSource_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreResult" ADD CONSTRAINT "ScoreResult_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
