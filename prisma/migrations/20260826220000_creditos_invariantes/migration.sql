-- Invariantes que faltavam nos créditos.
--
-- Aditiva: uma coluna, um índice, uma FK e um CHECK. A migration
-- `20260826200000_creditos` não é tocada.
--
-- `seq` existe porque `createdAt` não ordena nada dentro de uma transação:
-- `NOW()` é estável do BEGIN ao COMMIT, então o `ROLLOVER` e a `RESERVA` que
-- acontecem juntos carimbam o mesmo instante. O extrato ficava sem ordem
-- exatamente onde a ordem é a pergunta — qual saldo veio antes de qual.
-- `BIGSERIAL` é atribuído na escrita, é monotônico e não empata.
--
-- O CHECK de `estimatedBy` fecha o domínio no banco. A validação em código
-- protege o caminho da aplicação; esta protege o caminho do script, do console
-- e da migration de dados — que é por onde valores estranhos costumam entrar.

-- AlterTable
ALTER TABLE "CreditLedgerEntry" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_seq_key" ON "CreditLedgerEntry"("seq");

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Como o valor foi estimado, de um conjunto fechado.
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_estimado_ck"
    CHECK ("estimatedBy" IN ('PRECO_DA_ORGANIZACAO'));
