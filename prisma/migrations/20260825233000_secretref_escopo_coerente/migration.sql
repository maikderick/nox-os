-- Coerência entre escopo e dono, e unicidade que de fato vale.
--
-- O índice único anterior era ([scope], [organizationId], [purpose]). Em
-- PostgreSQL, NULL nunca é igual a NULL, então para as linhas de PLATAFORMA —
-- que têm organizationId nulo por definição — ele não impedia duplicata
-- nenhuma. Dois segredos com o mesmo propósito global podiam coexistir, e qual
-- deles o resolvedor encontraria era sorte.
--
-- Escrito à mão porque o Prisma não expressa CHECK nem índice parcial. Quem
-- gerar a próxima migration por diff precisa preservar os três objetos abaixo.

ALTER TABLE "SecretRef"
    ADD CONSTRAINT "SecretRef_scope_owner_ck" CHECK (
        ("scope" = 'PLATAFORMA' AND "organizationId" IS NULL)
        OR ("scope" = 'ORGANIZACAO' AND "organizationId" IS NOT NULL)
    );

DROP INDEX IF EXISTS "SecretRef_scope_organizationId_purpose_key";

-- Um propósito global, uma linha.
CREATE UNIQUE INDEX "SecretRef_purpose_plataforma_key"
    ON "SecretRef" ("purpose")
    WHERE "organizationId" IS NULL;

-- Um propósito por organização, uma linha.
CREATE UNIQUE INDEX "SecretRef_purpose_organizacao_key"
    ON "SecretRef" ("organizationId", "purpose")
    WHERE "organizationId" IS NOT NULL;
