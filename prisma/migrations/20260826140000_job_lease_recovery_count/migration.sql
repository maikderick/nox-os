-- Contador de resgates de lease.
--
-- Aditiva, com default: linhas existentes passam a valer zero, que é
-- exatamente o que elas significam — nenhum resgate registrado até aqui.
--
-- Separado de `attempts` de propósito. Consumidor morto não é job falhado: o
-- processo parou de existir, nada foi tentado e recusado, e gastar tentativa
-- ali deixaria quatro deploys durante uma geração longa matarem um run
-- saudável. Mas um job que derruba TODO consumidor que o executa também não é
-- a plataforma caindo, e sem este contador nada distingue os dois casos.

ALTER TABLE "Job" ADD COLUMN "leaseRecoveryCount" INTEGER NOT NULL DEFAULT 0;
