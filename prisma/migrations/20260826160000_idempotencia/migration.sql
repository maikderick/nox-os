-- Idempotência de requisição.
--
-- Aditiva: cria uma tabela e nada mais. Nenhuma coluna, tabela ou índice
-- existente é tocado, então código antigo continua funcionando com o banco à
-- frente.
--
-- Nada aqui é escrito à mão. O único índice único é comum, está declarado no
-- schema como `@@unique([organizationId, scope, key])`, e o `migrate diff` o
-- preserva sozinho — ao contrário do parcial de `Job`, que vive só no arquivo
-- da sua migration. Ver `docs/errata-migrations.md`.
--
-- A unicidade inclui `organizationId` de propósito: a chave é fornecida pelo
-- cliente, e duas organizações escolhendo o mesmo UUID não podem se atropelar.

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "sideEffect" TEXT NOT NULL DEFAULT 'EXTERNO_AMBIGUO',
    "responseJson" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_status_expiresAt_idx" ON "IdempotencyKey"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organizationId_scope_key_key" ON "IdempotencyKey"("organizationId", "scope", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
