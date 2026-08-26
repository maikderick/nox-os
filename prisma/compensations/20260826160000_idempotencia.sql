-- Compensação de `20260826160000_idempotencia`.
--
-- NÃO APLICADA. Escrita no commit que a origina, guardada aqui, e revisada
-- antes de qualquer uso — a regra que o `SecretRef` da Fase 3 estabeleceu.
-- Desfazer é migration compensatória nova; nunca edição, nunca remoção do
-- arquivo já aplicado.
--
-- PRÉ-CONDIÇÃO, e ela não é formalidade:
--
--   SELECT count(*) FROM "IdempotencyKey" WHERE "status" = 'EM_ANDAMENTO';
--
-- Precisa devolver zero. Uma chave `EM_ANDAMENTO` é uma intenção que alguém
-- registrou e cuja resposta ainda não foi gravada. Derrubar a tabela com uma
-- dessas viva apaga a única prova de que aquele pedido existiu — e o cliente,
-- ao repetir, recebe um trabalho novo em vez da resposta do primeiro. Se a
-- intenção tinha efeito externo, isso é o efeito acontecendo duas vezes.
--
-- Ordem de queda, inversa das dependências:

DROP INDEX IF EXISTS "IdempotencyKey_organizationId_scope_key_key";
DROP INDEX IF EXISTS "IdempotencyKey_status_expiresAt_idx";

ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "IdempotencyKey_organizationId_fkey";

DROP TABLE IF EXISTS "IdempotencyKey";
