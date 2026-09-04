-- Compensação de `20260826220000_creditos_invariantes`.
--
-- NÃO APLICADA. Escrita no commit que a origina, guardada aqui, revisada antes
-- de qualquer uso.
--
-- PRÉ-CONDIÇÃO: nenhuma, para o CHECK e para a FK — derrubá-los não perde
-- dado, só afrouxa o que passa a ser aceito daí em diante.
--
-- `seq` é outra história. Derrubar a coluna apaga a ÚNICA ordem total do
-- extrato: `createdAt` empata dentro de uma transação, e sem `seq` não há como
-- dizer se o saldo depois do `ROLLOVER` veio antes ou depois do saldo depois da
-- `RESERVA` que aconteceu no mesmo commit. Uma reconciliação futura fica sem
-- resposta para a pergunta que ela existe para responder.
--
-- Exportar antes, se houver qualquer linha:
--
--   copy (SELECT * FROM "CreditLedgerEntry" ORDER BY "seq")
--     TO 'credit-ledger-<data>.csv' WITH (FORMAT csv, HEADER true);
--
-- Ordem de queda, inversa das dependências:

ALTER TABLE "CreditReservation" DROP CONSTRAINT IF EXISTS "CreditReservation_estimado_ck";
ALTER TABLE "CreditReservation" DROP CONSTRAINT IF EXISTS "CreditReservation_reconciledById_fkey";

DROP INDEX IF EXISTS "CreditLedgerEntry_seq_key";
ALTER TABLE "CreditLedgerEntry" DROP COLUMN IF EXISTS "seq";
