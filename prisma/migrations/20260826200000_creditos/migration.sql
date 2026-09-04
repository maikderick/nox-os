-- Créditos: preço, conta, reserva e extrato.
--
-- Aditiva: três tabelas novas e nada mais. Nenhuma coluna, tabela ou índice
-- existente é tocado.
--
-- Os CHECKs no fim são escritos à mão. O Prisma não expressa CHECK, e estes
-- não são detalhe: sem eles, um bug de aplicação transforma dinheiro em número
-- negativo e o extrato deixa de reconstruir a conta. Quem gerar a próxima
-- migration por diff precisa preservá-los — como o índice parcial de `Job` e
-- os CHECKs de `IdempotencyKey`. Ver `docs/errata-migrations.md`.

-- CreateTable
CREATE TABLE "CreditAccount" (
    "organizationId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "consumedThisMonthCents" INTEGER NOT NULL DEFAULT 0,
    "monthlyCapCents" INTEGER NOT NULL DEFAULT 0,
    "periodStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generationPriceCents" INTEGER,
    "blockedAt" TIMESTAMP(3),
    "blockedReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "jobId" TEXT,
    "generationRunId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVADA',
    "estimatedBy" TEXT NOT NULL,
    "reconciledCents" INTEGER,
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reservationId" TEXT,
    "movement" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "reservedAfterCents" INTEGER NOT NULL,
    "consumedAfterCents" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_generationRunId_key" ON "CreditReservation"("generationRunId");

-- CreateIndex
CREATE INDEX "CreditReservation_organizationId_status_idx" ON "CreditReservation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CreditReservation_status_expiresAt_idx" ON "CreditReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_organizationId_operationKey_key" ON "CreditReservation"("organizationId", "operationKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_organizationId_createdAt_idx" ON "CreditLedgerEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_reservationId_idx" ON "CreditLedgerEntry"("reservationId");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CreditAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "CreditAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "CreditReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dinheiro é centavo inteiro e não negativo, e reserva nunca passa do saldo.
--
-- `reservedCents <= balanceCents` é o invariante que impede prometer o que não
-- se tem: disponível é `balance − reserved`, e se a reserva pudesse passar do
-- saldo o disponível ficaria negativo — uma conta devendo dinheiro que ninguém
-- pôs lá.
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_nao_negativo_ck"
    CHECK ("balanceCents" >= 0
       AND "reservedCents" >= 0
       AND "consumedThisMonthCents" >= 0
       AND "monthlyCapCents" >= 0
       AND "reservedCents" <= "balanceCents");

-- Preço nulo significa não configurado, e recusa a geração. Preço zero seria
-- outra coisa — geração de graça — e não é o que "não configurado" quer dizer.
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_preco_ck"
    CHECK ("generationPriceCents" IS NULL OR "generationPriceCents" > 0);

-- Uma reserva compromete um valor positivo, e o valor conciliado, quando
-- existe, também é centavo não negativo.
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_valor_ck"
    CHECK ("amountCents" > 0
       AND ("reconciledCents" IS NULL OR "reconciledCents" >= 0));

-- Domínio fechado do estado da reserva.
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_status_ck"
    CHECK ("status" IN ('RESERVADA', 'CONSUMIDA', 'LIBERADA', 'CONCILIACAO'));

-- Domínio fechado do movimento, e os três "depois" nunca negativos: eles são
-- a fotografia da conta no instante da linha, e uma fotografia impossível
-- torna o extrato inútil justamente na auditoria em que ele importa.
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_movimento_ck"
    CHECK ("movement" IN ('RESERVA', 'CONSUMO', 'LIBERACAO', 'AJUSTE', 'BLOQUEIO', 'ROLLOVER', 'APORTE'));

ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_depois_ck"
    CHECK ("balanceAfterCents" >= 0
       AND "reservedAfterCents" >= 0
       AND "consumedAfterCents" >= 0);
