-- Disposição da tentativa de início, fato do check, e um run por revisão.
--
-- Aditiva em colunas e em tabela. As colunas de `GenerationRun` nascem nulas
-- (ou com default), e `GenerationCheck` não existia — nada que já esteja no
-- banco muda de significado, então código antigo continua funcionando com o
-- banco à frente.
--
-- O que **não** é aditivo é o índice único em `SiteRevision.generationRunId`.
-- Ele é uma restrição sobre linhas que já existem, e por isso vem depois de uma
-- verificação explícita: se alguma instalação já tiver dois `SiteRevision`
-- apontando para o mesmo run, a migration precisa falhar aqui, com a linha
-- nomeada, em vez de falhar na criação do índice com uma mensagem que não diz
-- qual run é.
--
-- Os dois CHECKs da disposição são escritos à mão. O Prisma 5 não expressa
-- CHECK, então eles vivem só neste arquivo; o `migrate diff` não os enxerga e
-- não os remove, mas quem escrever a próxima migration por diff precisa
-- preservá-los. Ver `docs/errata-migrations.md`.

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "providerIdempotencyKey" TEXT,
ADD COLUMN     "pullRequestUrl" TEXT,
ADD COLUMN     "startAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "startDisposition" TEXT NOT NULL DEFAULT 'NAO_TENTADO';

-- CreateTable
CREATE TABLE "GenerationCheck" (
    "id" TEXT NOT NULL,
    "siteRevisionId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "externalId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationCheck_commitSha_idx" ON "GenerationCheck"("commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationCheck_siteRevisionId_name_key" ON "GenerationCheck"("siteRevisionId", "name");

-- AddForeignKey
ALTER TABLE "GenerationCheck" ADD CONSTRAINT "GenerationCheck_siteRevisionId_fkey" FOREIGN KEY ("siteRevisionId") REFERENCES "SiteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Um run produz uma revisão. Sem esta restrição, um lease vencido com o handler
-- anterior ainda vivo cria a segunda — e a partir daí a barreira compara fatos
-- de revisões diferentes, e ou nunca fecha, ou fecha sobre o `commitSha`
-- errado.
DO $$
DECLARE
    duplicado TEXT;
BEGIN
    SELECT "generationRunId" INTO duplicado
      FROM "SiteRevision"
     WHERE "generationRunId" IS NOT NULL
     GROUP BY "generationRunId"
    HAVING COUNT(*) > 1
     LIMIT 1;

    IF duplicado IS NOT NULL THEN
        RAISE EXCEPTION
            'Existe mais de uma SiteRevision para o GenerationRun %. Resolva a duplicata antes de aplicar esta migration.',
            duplicado;
    END IF;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX "SiteRevision_generationRunId_key" ON "SiteRevision"("generationRunId");

-- Domínio fechado da disposição. Nenhum texto de provedor entra na coluna.
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_disposicao_ck"
    CHECK ("startDisposition" IN
        ('NAO_TENTADO', 'EM_TENTATIVA', 'SEM_EFEITO_COMPROVADO', 'INICIADO', 'AMBIGUO'));

-- Backfill antes do CHECK que vem a seguir.
--
-- Um run gravado por uma fase anterior pode ter `providerRunId` e a disposição
-- default. Ele **é** um run iniciado — o provedor devolveu um identificador —,
-- e a coluna nova só não sabia disso ainda. Sem esta linha o CHECK seguinte
-- recusaria a própria migration, num banco cujos dados estão corretos.
UPDATE "GenerationRun"
   SET "startDisposition" = 'INICIADO'
 WHERE "providerRunId" IS NOT NULL
   AND "startDisposition" = 'NAO_TENTADO';

-- `INICIADO` e `providerRunId` andam juntos, nos dois sentidos.
--
-- `INICIADO` sem `providerRunId` seria dizer que o provedor começou sem saber
-- qual execução é — o poll não teria o que consultar. `providerRunId` sem
-- `INICIADO` é a mesma incoerência do outro lado: existe execução gravada e a
-- disposição autoriza chamar de novo. Nos dois casos o banco recusa, porque a
-- coisa que o código está prestes a fazer depende exatamente dessa coerência.
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_iniciado_ck"
    CHECK (("startDisposition" = 'INICIADO') = ("providerRunId" IS NOT NULL));

-- Domínio fechado do fato do check.
ALTER TABLE "GenerationCheck" ADD CONSTRAINT "GenerationCheck_conclusao_ck"
    CHECK ("conclusion" IN ('PENDENTE', 'EM_EXECUCAO', 'SUCESSO', 'FALHA', 'AUSENTE'));
