-- Posse da execução, e o domínio fechado do estado.
--
-- Aditiva: acrescenta uma coluna anulável e um CHECK que as linhas existentes
-- já satisfazem. A migration anterior não é tocada.
--
-- `ownerToken` existe porque renovar `expiresAt` não é tomar posse. Dois
-- chamadores encontrando a mesma chave vencida renovavam os dois e executavam
-- os dois — o defeito que esta coluna fecha. Quem toma posse escreve um token
-- novo, e concluir, liberar ou conciliar conferem esse token: um executor
-- antigo que termine depois não sobrescreve o resultado de quem tomou o lugar.
--
-- O CHECK torna `CONCILIACAO` um estado de verdade, e não uma exceção em voo.
-- Escrito à mão porque o Prisma não expressa CHECK; quem gerar a próxima
-- migration por diff precisa preservá-lo, como o parcial de `Job`.

ALTER TABLE "IdempotencyKey" ADD COLUMN "ownerToken" TEXT;

ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_status_ck"
    CHECK ("status" IN ('EM_ANDAMENTO', 'CONCLUIDA', 'CONCILIACAO'));

-- Uma chave em andamento tem dono; uma que não está, não tem.
--
-- Sem isto, um token esquecido numa linha concluída passaria a valer como posse
-- na próxima vez que alguém a lesse.
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_posse_ck"
    CHECK (("status" = 'EM_ANDAMENTO') = ("ownerToken" IS NOT NULL));
