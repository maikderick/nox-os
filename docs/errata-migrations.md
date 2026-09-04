# Errata de migrations

Onde o comentário de uma migration aplicada está errado, a correção vem para
cá. O arquivo da migration não é editado.

**A regra, e por que ela vale até para um comentário.** O Prisma grava em
`_prisma_migrations.checksum` o SHA-256 do arquivo no momento em que ele foi
aplicado. Um comentário alterado muda esse hash exatamente como mudaria um
`ALTER TABLE`, e a partir daí o histórico do banco e o diretório do repositório
descrevem coisas diferentes. Que `migrate deploy` e `migrate status` do Prisma 5
não recusem hoje é uma característica desta versão, não uma garantia — e a regra
existe justamente para não depender de qual comando verifica o quê.

Então o arquivo aplicado é imutável, ponto. O que muda é o schema, que é lido
por quem vai escrever a próxima migration, e esta errata, que é lida por quem
está lendo a migration antiga.

---

## `20260826120000_fila_durable`

**O que o cabeçalho diz:** que os dois índices únicos no fim do arquivo são
escritos à mão e não saem de nenhum `prisma migrate diff`.

**O que é verdade:** só um dos dois.

| Índice | Situação real |
| --- | --- |
| `Job_concurrency_ativo_uniq` | **Parcial.** O Prisma 5 não expressa índice parcial, então ele existe só naquele arquivo. Quem gerar a próxima migration por diff precisa preservá-lo à mão. |
| `Job_idempotency_uniq` | Índice único **comum**. Está declarado no schema como `@@unique([organizationId, idempotencyKey], map: "Job_idempotency_uniq")`, e o `map` fixa o nome para que schema e migration nomeiem o mesmo objeto. O diff o enxerga e o preserva sozinho. |

**Como isso apareceu.** A declaração no schema não existia quando a migration
foi escrita, e o teste de drift do commit 1 pegou o resultado: o `migrate diff`
seguinte queria escrever um `DROP INDEX "Job_idempotency_uniq"`. A linha foi
acrescentada ao schema no mesmo commit; o cabeçalho da migration, que já estava
aplicada, ficou desatualizado.

**Onde a versão correta está:** no comentário de `Job` em `prisma/schema.prisma`,
e o teste `tests/unit/prisma-drift-db.test.ts` verifica os dois índices contra
`pg_indexes`, incluindo o predicado do parcial.

---

## `20260826220000_creditos_invariantes`

**O que o cabeçalho diz:** que `createdAt` não ordena o extrato porque
`NOW()` é estável do BEGIN ao COMMIT, então duas linhas da mesma transação
carimbam o mesmo instante.

**O que é verdade:** a conclusão está certa e o motivo está errado, de um jeito
que importa.

O Prisma preenche `@default(now())` **no cliente**. O valor viaja como
parâmetro do `INSERT`, e o `DEFAULT CURRENT_TIMESTAMP` da coluna nunca chega a
ser usado — conferido lendo o SQL emitido, onde `createdAt` aparece entre os
parâmetros e duas linhas da mesma transação saíram com 4 ms de diferença.

Ou seja, `createdAt` não é o relógio do banco: é o **relógio deste processo**.
E isso é pior do que empatar, porque:

| Falha | Consequência |
| --- | --- |
| resolução de milissegundo | duas escritas rápidas empatam, e o extrato fica sem ordem |
| relógio do processo | contradiz a regra de um relógio só que o resto da fase segue |
| passo de NTP para trás | a ordem **inverte**, e nenhuma ordenação sobrevive a isso |

`seq` resolve os três: é atribuído pelo banco na escrita, é monotônico e é
único.

**Onde a versão correta está:** no comentário de `CreditLedgerEntry` em
`prisma/schema.prisma` e no cabeçalho de `src/lib/credits/ledger.ts`.

---

## `20260830090000_geracao_disposicao_e_checks`

Nada errado no cabeçalho — esta entrada existe para nomear o que o arquivo tem
de **não aditivo**, porque quem ler "migration aditiva" no resto da fase pode
supor que esta também é.

Ela cria colunas nulas e uma tabela nova, o que é aditivo. Mas também cria um
**índice único em `SiteRevision.generationRunId`**, que é uma restrição sobre
linhas que já existem. Por isso o arquivo verifica antes, com um `RAISE
EXCEPTION` que nomeia o run duplicado: falhar na criação do índice diria apenas
que há duplicata, sem dizer qual.

E há um `UPDATE` de backfill antes do `CHECK` `GenerationRun_iniciado_ck`. Um
run gravado por uma fase anterior pode ter `providerRunId` e a disposição
default — ele **é** um run iniciado, e a coluna nova só não sabia disso. Sem o
backfill o CHECK recusaria a própria migration num banco cujos dados estão
corretos.

**Os dois CHECKs são escritos à mão.** O Prisma 5 não expressa CHECK, então eles
vivem só neste arquivo; o `migrate diff` não os enxerga, não os remove — e não
os recria. Quem escrever a próxima migration por diff precisa preservá-los.

---

## `20260830093000_deployment_commit`

Aditiva, uma coluna e um índice. Registrada aqui só para explicar por que a
coluna existe, já que a informação parece redundante: `Deployment` aponta para
`SiteRevision`, que já tem `commitSha`.

A redundância é o ponto, e é a mesma de `GenerationCheck.commitSha`. A barreira
só conclui quando os três fatos apontam para a mesma revisão **e** o mesmo
commit. Sem esta coluna, a prévia responderia apenas pela revisão, e uma build
de um commit anterior da mesma revisão passaria por atual.
