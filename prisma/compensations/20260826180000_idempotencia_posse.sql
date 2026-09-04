-- Compensação de `20260826180000_idempotencia_posse`.
--
-- NÃO APLICADA. Escrita no commit que a origina, guardada aqui, revisada antes
-- de qualquer uso.
--
-- PRÉ-CONDIÇÃO:
--
--   SELECT count(*) FROM "IdempotencyKey" WHERE "status" = 'EM_ANDAMENTO';
--
-- Precisa devolver zero. Derrubar `ownerToken` com execuções vivas apaga a
-- posse delas: dois executores voltariam a poder concluir a mesma chave, que é
-- exatamente o defeito que a coluna fechou.
--
-- Derrubar o CHECK de estado é seguro por si só, mas note que linhas em
-- `CONCILIACAO` continuam existindo depois — e voltam a ser aceitáveis para um
-- código que só conhece dois estados. Confira que não há nenhuma antes:
--
--   SELECT count(*) FROM "IdempotencyKey" WHERE "status" = 'CONCILIACAO';
--
-- Ordem de queda, inversa das dependências:

ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "IdempotencyKey_posse_ck";
ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "IdempotencyKey_status_ck";

ALTER TABLE "IdempotencyKey" DROP COLUMN IF EXISTS "ownerToken";
