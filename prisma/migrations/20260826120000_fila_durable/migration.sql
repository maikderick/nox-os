-- Fila durável: uma etapa por job.
--
-- Os dois índices únicos no fim são escritos à mão, e não saem de nenhum
-- `prisma migrate diff`. O Prisma 5 não expressa índice parcial, e aqui a
-- parcialidade é o desenho inteiro:
--
--   * a chave de idempotência identifica UMA ETAPA. Um índice sobre o trabalho
--     lógico impediria a segunda etapa da mesma cadeia de ser enfileirada,
--     e a cadeia simplesmente não andaria.
--
--   * a chave de concorrência exclui um segundo trabalho MUTANTE do mesmo
--     projeto enquanto o primeiro está vivo. Um índice total sobre ela
--     impediria o segundo para sempre, mesmo com o primeiro terminado.
--
-- Quem gerar a próxima migration por diff precisa preservar os dois.

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteProjectId" TEXT,
    "generationRunId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "idempotencyKey" TEXT NOT NULL,
    "concurrencyKey" TEXT,
    "payloadJson" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "pollDeadlineAt" TIMESTAMP(3),
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_organizationId_kind_status_idx" ON "Job"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "Job_leaseExpiresAt_idx" ON "Job"("leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteProjectId_fkey" FOREIGN KEY ("siteProjectId") REFERENCES "SiteProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma etapa, um job, para sempre.
CREATE UNIQUE INDEX "Job_idempotency_uniq"
    ON "Job" ("organizationId", "idempotencyKey");

-- Um job mutante ativo por projeto. Observadores têm chave nula e, como NULL
-- nunca é igual a NULL em PostgreSQL, não entram no índice nem se excluem.
-- CONCILIACAO está na lista de propósito: um trabalho parado esperando gente
-- ainda é um trabalho vivo, e deixar outro entrar por cima dele seria começar
-- a segunda geração justamente quando a primeira está sob suspeita.
CREATE UNIQUE INDEX "Job_concurrency_ativo_uniq"
    ON "Job" ("concurrencyKey")
    WHERE "concurrencyKey" IS NOT NULL
      AND "status" IN ('PENDENTE', 'EM_EXECUCAO', 'PAUSADO', 'CONCILIACAO');
