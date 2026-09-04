-- O commit que a plataforma construiu, gravado na prévia.
--
-- Aditiva: uma coluna nula e um índice. Nenhuma linha existente muda de
-- significado — um `Deployment` gravado antes desta migration simplesmente não
-- registrou o commit, e nulo é exatamente isso.
--
-- Por que a coluna existe: a barreira só conclui quando os três fatos apontam
-- para a **mesma revisão e o mesmo commit**. Sem esta coluna a prévia só
-- responderia pela revisão, e uma build de um commit anterior da mesma revisão
-- passaria por atual.

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "commitSha" TEXT;

-- CreateIndex
CREATE INDEX "Deployment_commitSha_idx" ON "Deployment"("commitSha");
