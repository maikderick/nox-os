-- Compensação de `20260826160000_idempotencia`.
--
-- NÃO APLICADA. Escrita no commit que a origina, guardada aqui, e revisada
-- antes de qualquer uso — a regra que o `SecretRef` da Fase 3 estabeleceu.
-- Desfazer é migration compensatória nova; nunca edição, nunca remoção do
-- arquivo já aplicado.
--
-- PRÉ-CONDIÇÃO: a tabela precisa estar VAZIA.
--
--   SELECT count(*) FROM "IdempotencyKey";   -- precisa devolver zero
--
-- Não basta exigir zero chaves `EM_ANDAMENTO`, que era o que esta compensação
-- dizia antes. Uma chave `CONCLUIDA` não é um registro morto: ela é a única
-- prova de que aquele pedido já foi atendido, e a resposta que o cliente recebe
-- ao repetir. Apagá-la faz a repetição virar um pedido novo — se a intenção
-- tinha efeito externo, é o efeito acontecendo duas vezes, e é pior justamente
-- nos casos que a tabela existia para proteger.
--
-- Uma chave em `CONCILIACAO` é pior ainda de perder: ela marca um caso que
-- alguém precisa examinar, e apagá-la devolve a intenção ao fluxo comum como se
-- nada tivesse acontecido.
--
-- ESTRATÉGIA DE PRESERVAÇÃO, quando a tabela não está vazia.
--
-- Derrubar a tabela com linhas dentro só é aceitável com as linhas guardadas
-- fora dela, e com quem opera sabendo que a proteção fica suspensa até serem
-- restauradas. Exportar antes:
--
--   \copy (SELECT * FROM "IdempotencyKey" ORDER BY "createdAt")
--     TO 'idempotency-keys-<data>.csv' WITH (FORMAT csv, HEADER true);
--
-- Guardar o arquivo junto do registro da operação. Enquanto ele não voltar,
-- toda intenção antiga é repetível — inclusive as externas.
--
-- Alternativa preferível, e quase sempre a certa: não derrubar. A tabela é
-- aditiva e inerte para código que não a usa. Manter o rollback só no
-- comportamento custa uma tabela sem leitores e não custa nenhuma repetição.
--
-- Ordem de queda, inversa das dependências:

DROP INDEX IF EXISTS "IdempotencyKey_organizationId_scope_key_key";
DROP INDEX IF EXISTS "IdempotencyKey_status_expiresAt_idx";

ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "IdempotencyKey_organizationId_fkey";

DROP TABLE IF EXISTS "IdempotencyKey";
