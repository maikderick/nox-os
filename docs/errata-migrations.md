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
