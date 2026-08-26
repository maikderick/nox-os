# Fase 4 — Fila durável, créditos e Cursor

> **Papel:** plano executável. É isto que se implementa.
> **Autoridade:** [spec da arquitetura-alvo](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> **Contexto:** [plano mestre das Fases 3 a 6](2026-08-25-fases-3-a-6-plano-mestre.md).
> **Pré-requisito:** Fase 3 aprovada e encerrada em `30645e7`.
> **Revisão 2** — incorpora as doze correções e as seis decisões aprovadas.

**Objetivo:** dado um `SiteProject` provisionado, o NOX OS enfileira uma geração
de forma durável, reserva crédito antes de qualquer operação paga, orquestra o
Cursor Cloud Agent por polling, acompanha checks do GitHub e preview da Vercel, e
move o projeto de `GERANDO` para `PREVIA_PRONTA` ou `FALHOU` com base em fatos
verificados — nunca em suposição.

## O que fica ligado ao fim da fase

Nada externo. Provedores em `DESLIGADO` (padrão), `FALSO` ou `SANDBOX`. Nenhuma
chamada paga, repositório remoto, projeto Vercel ou agente Cursor.

## Fora de escopo

Aprovação, publicação, promoção a produção, rollback de site, domínio e SSL —
Fase 5. Modo `LIVE` — Fase 6. Expurgo automático de jobs — fora desta fase por
decisão. Webhook e SSE entram apenas como aceleradores opcionais (commit 15).

Se algo parecer exigir um destes, **pare e reporte**.

---

## Decisões aprovadas

| Decisão | Valor |
| --- | --- |
| Cursor ao fim da fase | `FALSO` e `SANDBOX` no commit 16; `LIVE` continua fora |
| `SANDBOX` do Cursor | **replay local de fixtures, sem HTTP** |
| Consumidor | Vercel Cron |
| Retentativas de falha real | 5, base 30 s, teto 15 min, full jitter |
| Preço | política **local** configurável; sem configuração, geração recusada |
| Reserva de crédito | limiar **renovável** de 2 h |
| Expurgo de jobs concluídos | não existe na Fase 4 |

---

## Princípios que este plano leva a sério

### Espera não é falha

Cursor executando, check pendente e preview construindo são **estados normais**.
Eles não consomem tentativa, não aplicam backoff de falha e nunca caminham para
carta morta. Contam `pollCount` e respeitam `pollDeadlineAt`; estourar o prazo
leva a `CONCILIACAO`, não a carta morta. Só falha real de execução mexe em
`attempts`.

### Efeito remoto nunca é repetido às cegas

Um lease expirado prova que o consumidor morreu, não que a chamada não
aconteceu. Antes de qualquer chamada que crie efeito remoto, grava-se
`startAttemptedAt`. Encontrar tentativa registrada sem `providerRunId` significa
ambiguidade: repetir só é permitido se o provedor declarar idempotência ou
reconciliação por chave. Caso contrário, `CONCILIACAO`.

O mesmo vale para TTL: uma chave de idempotência expirada **não** autoriza
repetir uma operação externa ambígua. Autoriza assumir trabalho local ou puro.

### Nenhum job espera à toa

O consumidor adquire **um job por vez, sob demanda**, dentro do orçamento. Não
existe lote pré-adquirido: um job com lease que nunca vai ser executado é um job
parado até o lease expirar, e isso é latência inventada.

### Polling é a verdade

Checks e preview **apenas registram fatos**. A transição para `PREVIA_PRONTA`
acontece numa barreira que confere os três fatos contra a mesma `SiteRevision` e
o mesmo `commitSha`. Webhook e SSE só antecipam `runAfter`.

### `GERANDO` fecha até o último commit

`STAGES_PENDING_ORCHESTRATOR` só perde `GERANDO` no commit 16. `PUBLICANDO`
permanece — é Fase 5. Consequência: os testes dos commits 11 a 14 **constroem** o
estado (`status: "GERANDO"` no fixture) em vez de transicionar para ele. O
caminho de entrada é ligado e testado ponta a ponta no commit 16. A trava não é
enfraquecida para acomodar teste.

### Não existe worker em processo

Serverless não sustenta laço vivo — a importação Overpass já aprendeu, e o
resultado é `INFINITE_LOOP_DETECTED`. O consumidor é rota com orçamento de tempo,
acionada por Cron, no mesmo formato de `runOverpassImportBurst(jobId, budgetMs =
235_000)` com `maxDuration = 300`.

### `FOR UPDATE SKIP LOCKED` é SQL cru

Prisma 5.22 não expressa. Vai de `$queryRaw`, e por isso ganha teste de
integração próprio contra o PostgreSQL local: a correção depende da semântica do
banco, não de TypeScript.

---

## Modelo de dados

Migrations aditivas, validadas **apenas** no PostgreSQL local. Todo modelo novo
tem FK e relação explícita; a coerência **entre organizações** é do serviço, e
tem teste negativo — uma FK garante que a linha existe, não que ela seja da
mesma organização.

```prisma
model Job {
  id             String   @id @default(cuid())

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  siteProjectId  String?
  siteProject    SiteProject? @relation(fields: [siteProjectId], references: [id], onDelete: Cascade)
  /// O job aponta para a intenção que já existe. O handler nunca cria outra.
  generationRunId String?
  generationRun   GenerationRun? @relation(fields: [generationRunId], references: [id], onDelete: Cascade)

  // generation.start | generation.poll | checks.poll | preview.poll | credit.reconcile
  kind           String
  // PENDENTE | EM_EXECUCAO | PAUSADO | CONCILIACAO | CONCLUIDO | FALHOU | CARTA_MORTA
  status         String   @default("PENDENTE")

  /// Identifica o trabalho lógico. Dois cliques produzem a mesma chave.
  idempotencyKey String
  /// Impede execução simultânea. Um por projeto, enquanto ativo.
  concurrencyKey String

  /// Ids e referências. Nunca um segredo — carrega o `purpose` do SecretRef.
  payloadJson    String

  /// Só falha real de execução incrementa.
  attempts       Int      @default(0)
  maxAttempts    Int      @default(5)
  /// Espera normal: agente executando, check pendente, preview construindo.
  pollCount      Int      @default(0)
  /// Até quando esperar antes de mandar para conciliação.
  pollDeadlineAt DateTime?

  runAfter       DateTime @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
  /// Motivo da pausa, quando PAUSADO. Nunca texto de provedor.
  pausedReason   String?

  lastError      String?
  lastErrorCode  String?
  correlationId  String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  finishedAt     DateTime?

  reservations   CreditReservation[]

  @@index([status, runAfter])
  @@index([organizationId, kind, status])
  @@index([leaseExpiresAt])
}
```

### Os dois índices, e por que têm formas diferentes

```sql
-- Um job por trabalho lógico, para sempre. Dois cliques colidem aqui.
CREATE UNIQUE INDEX "Job_idempotency_uniq"
    ON "Job" ("organizationId", "idempotencyKey");

-- Um job ativo por projeto. Terminais não bloqueiam nada, então uma geração
-- futura do mesmo site continua possível.
CREATE UNIQUE INDEX "Job_concurrency_ativo_uniq"
    ON "Job" ("concurrencyKey")
    WHERE "status" IN ('PENDENTE', 'EM_EXECUCAO', 'PAUSADO', 'CONCILIACAO');
```

A idempotência é **total** porque `idempotencyKey` é
`generation:<generationRunId>` — um `GenerationRun` é uma intenção única, e
reprocessar carta morta reaproveita a mesma linha em vez de criar outra.

A concorrência é **parcial** porque `concurrencyKey` é
`project:<siteProjectId>` — precisa bloquear enquanto há trabalho vivo e liberar
quando não há. `CONCILIACAO` conta como vivo de propósito: um estado ambíguo não
pode ganhar uma segunda geração ao lado.

Escrito à mão, como o `SecretRef` da Fase 3: o Prisma não expressa índice
parcial. O schema leva a anotação, e o teste de drift confere que o próximo diff
sai vazio.

```prisma
model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  scope          String
  key            String
  requestHash    String
  // EM_ANDAMENTO | CONCLUIDA
  status         String   @default("EM_ANDAMENTO")
  /// LOCAL — trabalho puro, assumível ao expirar.
  /// EXTERNO_RECONCILIAVEL — o provedor responde "o que existe para esta chave".
  /// EXTERNO_AMBIGUO — não dá para saber; expirar nunca autoriza repetir.
  sideEffect     String   @default("EXTERNO_AMBIGUO")
  responseJson   String?
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, scope, key])
  @@index([status, expiresAt])
}

/// Saldo, exposição e consumo. Uma linha por organização.
model CreditAccount {
  organizationId       String   @id
  organization         Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  /// Tudo que a organização tem. Reserva não desconta daqui.
  balanceCents         Int      @default(0)
  /// Comprometido em reservas vivas. Disponível = balance - reserved.
  reservedCents        Int      @default(0)
  /// Efetivamente gasto no período. Exposição ao teto = consumed + reserved.
  consumedThisMonthCents Int    @default(0)
  monthlyCapCents      Int      @default(0)
  periodStartedAt      DateTime @default(now())
  blockedAt            DateTime?
  /// Razão de conjunto fechado, nunca texto de provedor.
  blockedReasonCode    String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  reservations CreditReservation[]
}

model CreditReservation {
  id              String   @id @default(cuid())
  organizationId  String
  account         CreditAccount @relation(fields: [organizationId], references: [organizationId], onDelete: Cascade)
  /// Uma reserva por operação — `generation:<generationRunId>`.
  operationKey    String
  jobId           String?
  job             Job? @relation(fields: [jobId], references: [id], onDelete: SetNull)
  generationRunId String?
  generationRun   GenerationRun? @relation(fields: [generationRunId], references: [id], onDelete: SetNull)

  amountCents     Int
  // RESERVADA | CONSUMIDA | LIBERADA | CONCILIACAO
  status          String   @default("RESERVADA")
  /// Qual política local produziu o valor.
  estimatedBy     String
  reconciledCents Int?
  reconciledById  String?
  reconciledAt    DateTime?
  /// Limiar renovável. Vencer não libera nada por si só.
  expiresAt       DateTime
  renewedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, operationKey])
  @@index([organizationId, status])
  @@index([status, expiresAt])
}
```

`EXPIRADA` sumiu de propósito do enum da reserva: vencer o limiar não é um
desfecho, é um gatilho de decisão. O desfecho é `CONSUMIDA`, `LIBERADA` ou
`CONCILIACAO`.

`GenerationRun` ganha colunas nulas e aditivas: `branch`, `pullRequestUrl`,
`startAttemptedAt`, `reservationId`.

### Invariantes no banco

```sql
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_nao_negativo_ck"
    CHECK ("balanceCents" >= 0
       AND "reservedCents" >= 0
       AND "consumedThisMonthCents" >= 0
       AND "reservedCents" <= "balanceCents");
```

Saldo negativo e reserva maior que o saldo deixam de ser possíveis mesmo por
escrita fora da aplicação.

---

## Sequência de commits

Cada um verde sozinho. Nenhum liga integração ou cria recurso remoto.

### Commit 1 — `feat(fila)`: modelo, outbox e as duas chaves

**Arquivos**
- `prisma/schema.prisma` — `Job`, com FKs para `Organization`, `SiteProject` e
  `GenerationRun`.
- `prisma/migrations/<ts>_fila_durable/migration.sql` — tabela, FKs, o índice
  único total de idempotência e o **índice parcial** de concorrência, escritos à
  mão.
- `src/lib/jobs/kinds.ts` — `JOB_KINDS`, `JOB_STATUSES`, `ACTIVE_JOB_STATUSES`
  (a mesma lista do índice parcial, exportada para o serviço não divergir do
  banco), rótulos e type guards.
- `src/lib/jobs/keys.ts` — `idempotencyKeyForGeneration(runId)`,
  `concurrencyKeyForProject(siteProjectId)`.
- `src/lib/jobs/payload.ts` — allowlist por `kind`; campo desconhecido é recusado
  na escrita.
- `src/lib/jobs/outbox.ts` — `enqueueJob(tx, …)` exigindo
  `Prisma.TransactionClient`; conflito de idempotência devolve o job existente;
  conflito de concorrência recusa com razão fechada.

**Testes**
- `tests/unit/jobs-payload.test.ts` — allowlist aceita o declarado, recusa extra,
  recusa qualquer chave com cara de segredo (`token`, `privateKey`, `secret`).
- `tests/unit/jobs-keys.test.ts` — a mesma geração produz a mesma
  `idempotencyKey`; projetos diferentes produzem `concurrencyKey` diferentes.
- `tests/unit/jobs-outbox-db.test.ts` — contra o Postgres local:
  - **dois cliques não duplicam:** duas chamadas com a mesma `idempotencyKey`
    deixam um job só, e a segunda devolve o primeiro;
  - **projeto ocupado:** um segundo job com a mesma `concurrencyKey` enquanto o
    primeiro está ativo é recusado;
  - **geração futura continua possível:** com o primeiro job em `CONCLUIDO`,
    `FALHOU` ou `CARTA_MORTA`, um novo job para o mesmo projeto entra;
  - `CONCILIACAO` **bloqueia** um segundo job do mesmo projeto;
  - `enqueueJob` exige transação; a mudança de domínio e o job caem juntos.
- `tests/unit/jobs-cross-org-db.test.ts` — **negativo:** job da organização A
  referenciando projeto da B é recusado pelo serviço; a FK sozinha não protege,
  e o teste diz isso explicitamente.
- Teste de drift: `migrate diff` sai vazio apesar do índice parcial.

**Aceite** — nenhum job criado fora de transação; nenhuma duplicata por clique
duplo; nenhuma geração futura bloqueada por trabalho terminal.

**Janelas** — dois cliques simultâneos; duas abas do mesmo operador.

---

### Commit 2 — `feat(fila)`: aquisição com lease, sem contar tentativa

**Arquivos**
- `src/lib/jobs/claim.ts` — `claimJob({ owner, kinds, leaseMs })` devolvendo
  **um** job, com `$queryRaw` e `FOR UPDATE SKIP LOCKED`. Marca `EM_EXECUCAO`,
  grava `leaseOwner` e `leaseExpiresAt`. **Não** incrementa `attempts`:
  adquirir não é falhar.
- `src/lib/jobs/heartbeat.ts` — `extendLease(jobId, owner, ms)`, só para o dono.

**Testes**
- `tests/unit/jobs-claim-db.test.ts` — contra o Postgres local:
  - dois consumidores concorrentes não pegam o mesmo job;
  - `runAfter` futuro não é pego; lease vivo não é pego;
  - adquirir e devolver **não** mexe em `attempts`;
  - `extendLease` de outro dono não altera nada;
  - `PAUSADO` não é adquirido enquanto a pausa valer.

**Aceite** — a concorrência é provada com duas transações reais. É o commit em
que um mock provaria a coisa errada.

**Janelas** — dois crons simultâneos; consumidor lento segurando lease.

---

### Commit 3 — `feat(fila)`: desfechos, espera e pausa

Cinco saídas distintas, e a distinção é o ponto do commit.

**Arquivos**
- `src/lib/jobs/outcomes.ts`, todos aceitando `Prisma.TransactionClient`:
  - `completeJob` — terminal, libera a `concurrencyKey`;
  - `deferJob({ reason, nextRunAfter })` — **espera normal**: `pollCount++`,
    `runAfter` adiado, `attempts` intocado, sem `lastError`; estourar
    `pollDeadlineAt` leva a `CONCILIACAO`;
  - `pauseJob({ reasonCode })` — `PAUSADO`, `attempts` intocado, sem backoff de
    falha, sem carta morta;
  - `failJobRecoverable` — **única** que incrementa `attempts`; aplica backoff;
    ao esgotar `maxAttempts` vai a `CARTA_MORTA`;
  - `failJobPermanent` — `CARTA_MORTA` direto, sem consumir tentativas.
- `src/lib/jobs/backoff.ts` — full jitter, `random(0, min(15min, 30s · 2^n))`,
  com `random` injetável.
- Reuso de `describeErrorForStorage` da Fase 3 para `lastError`.

**Testes**
- `tests/unit/jobs-backoff.test.ts` — cresce, satura em 15 min, nunca negativo,
  duas tentativas no mesmo instante não coincidem.
- `tests/unit/jobs-outcomes.test.ts`:
  - **espera não é falha:** cem `deferJob` seguidos deixam `attempts` em zero e
    o job longe da carta morta;
  - `pollDeadlineAt` estourado vai a `CONCILIACAO`, **não** a carta morta;
  - só `failJobRecoverable` incrementa `attempts`;
  - `failJobPermanent` não consome tentativa;
  - terminal libera a `concurrencyKey` — provado por um segundo `enqueueJob` que
    agora passa.
- `tests/unit/jobs-error-redaction.test.ts` — cada formato de segredo da Fase 3:
  nada em `lastError`, `correlationId` gravado igual ao devolvido.

**Aceite** — nenhum estado normal caminha para carta morta. É o critério que
separa este commit do desenho anterior.

**Janelas** — agente executando por horas; check que demora; provedor lento.

---

### Commit 4 — `feat(fila)`: reconciliação de lease e carta morta

**Arquivos**
- `src/lib/jobs/reconcile.ts` — `reclaimExpiredLeases()` devolve `EM_EXECUCAO`
  com lease vencido para `PENDENTE`, **preservando `attempts` e `pollCount`**.
  Retomar não é falhar.
- `src/lib/jobs/dead-letter.ts` — `listDeadLetters(actor)`,
  `reprocessDeadLetter(actor, jobId)` zerando `attempts`, limpando lease,
  voltando a `PENDENTE`, com auditoria na mesma transação.
- `src/lib/authz/permissions.ts` — `job:read`, `job:run`.

**Testes**
- `tests/unit/jobs-reconcile-db.test.ts` — lease vencido volta, lease vivo não,
  contadores preservados.
- `tests/unit/jobs-dead-letter.test.ts` — reprocessar exige `job:run`; falha na
  auditoria desfaz o reprocessamento; reprocessar não fura a `concurrencyKey` se
  já houver outro job ativo para o projeto.
- Matriz: `OPERADOR` tem `job:read` e não `job:run`; `LEITOR` nenhum.

**Aceite** — consumidor interrompido não trava trabalho; reprocessar é ato humano
auditado.

**Janelas** — consumidor morre com lease na mão; carta morta reprocessada duas
vezes em paralelo.

---

### Commit 5 — `feat(fila)`: consumidor sob demanda

**Arquivos**
- `src/lib/jobs/consumer.ts` — `runJobBatch({ owner, budgetMs })`: reclama leases
  vencidos e então **adquire um job por vez**, executa, e só volta a adquirir se
  ainda houver orçamento. Nenhum job é adquirido para esperar. Registro de
  handlers por `kind`; `kind` sem handler vai a carta morta com código próprio.
- `src/app/api/jobs/run/route.ts` — `GET` para o Cron, `POST` manual;
  `maxDuration = 300`; `budgetMs = 235_000`.
- `vercel.json` — entrada `crons`.
- `src/lib/jobs/cron-auth.ts` — `Authorization: Bearer $CRON_SECRET` com
  comparação de tempo constante; disparo manual exige `job:run`.

**Testes**
- `tests/unit/jobs-consumer.test.ts`:
  - **nenhum job espera à toa:** com orçamento para dois e cinco na fila, apenas
    dois saem de `PENDENTE`; os outros três permanecem adquiríveis
    imediatamente, sem lease;
  - orçamento estourado no meio encerra sem adquirir mais nada;
  - handler que lança não derruba o lote;
  - o consumidor é seguro rodando em paralelo consigo mesmo.
- `tests/unit/jobs-run-route.test.ts` — `CRON_SECRET` errado → `401`; manual sem
  `job:run` → `403`.

**Aceite** — nenhum laço permanente, nenhuma recursão entre funções, nenhum lease
ocioso.

**Janelas** — cron dispara enquanto o anterior roda; lote estoura o orçamento.

---

### Commit 6 — `feat(fila)`: freio global sem punir job

**Arquivos**
- `src/lib/jobs/gate.ts` — antes de executar um handler que depende de provedor,
  resolve o modo efetivo. `DESLIGADO` — por banco ou por
  `NOX_INTEGRATIONS=disabled` — resulta em `pauseJob`, com
  `pausedReason = "INTEGRACAO_DESLIGADA"` e reagendamento fixo curto.
- Declaração por `kind` de qual provedor ele depende; `credit.reconcile` não
  depende de nenhum e continua rodando.

**Testes**
- `tests/unit/jobs-gate.test.ts`:
  - com `NOX_INTEGRATIONS=disabled`, o job vai a `PAUSADO` com `attempts` **em
    zero**, sem `lastError`, sem backoff de falha;
  - mil ciclos com o freio ligado não levam nenhum job à carta morta;
  - religando, o job volta a `PENDENTE` e executa;
  - jobs sem dependência de provedor continuam executando com o freio ligado.

**Aceite** — o freio é pausa, não punição. Um mês de manutenção não pode
transformar a fila inteira em carta morta.

**Janelas** — freio ligado durante um run em andamento; freio ligado e desligado
entre ciclos.

---

### Commit 7 — `feat(creditos)`: preço local e reserva atômica

**Arquivos**
- `src/lib/credits/pricing.ts` — **política local pura**: sem rede, sem segredo,
  sem provedor. `estimateGenerationCost({ organizationId, config })`; sem preço
  configurado, lança razão fechada `PRECO_NAO_CONFIGURADO`.
- `prisma/schema.prisma` + migration — `CreditAccount`, `CreditReservation`, com
  FKs e o `CHECK` de não-negatividade.
- `src/lib/credits/reserve.ts` — `reserveCredits(tx, …)`. Um `UPDATE`
  condicional:

  ```sql
  UPDATE "CreditAccount"
     SET "reservedCents" = "reservedCents" + $amount
   WHERE "organizationId" = $org
     AND "blockedAt" IS NULL
     AND "balanceCents" - "reservedCents" >= $amount
     AND "consumedThisMonthCents" + "reservedCents" + $amount <= "monthlyCapCents"
  ```

  Zero linhas significa que não cabe. A inserção da reserva e a linha do
  `UsageLedger` vão na mesma transação.

**Testes**
- `tests/unit/credits-pricing.test.ts` — sem configuração, **recusa antes de
  qualquer reserva**; a política não importa nada de rede nem de `SecretRef` —
  teste que varre os imports do módulo.
- `tests/unit/credits-db.test.ts` — contra o Postgres local:
  - disponível é `balance − reserved`: com saldo 100 e reservado 80, uma reserva
    de 30 é recusada;
  - exposição ao teto é `consumed + reserved`: teto 100, consumido 60,
    reservado 30, reserva de 20 recusada;
  - conta bloqueada não reserva;
  - N reservas concorrentes com espaço para N−1 deixam exatamente uma de fora;
  - mesma `operationKey` concorrente produz uma reserva só;
  - retentativa reencontra a reserva existente;
  - falha ao gravar o ledger desfaz o movimento do saldo;
  - o `CHECK` recusa saldo negativo e reserva maior que o saldo.

**Aceite** — sem preço, não há geração. Reserva não desconta saldo; compromete.

**Janelas** — duas gerações simultâneas com espaço para uma; morte entre reservar
e registrar.

---

### Commit 8 — `feat(creditos)`: liquidação, limiar renovável e conciliação

**Arquivos**
- `src/lib/credits/settle.ts`:
  - `consumeReservation(tx, { reservationId, actualCents })` —
    `reserved −= reservado`, `balance −= real`, `consumedThisMonth += real`. Se o
    real exceder a reserva e o excedente **não** couber em saldo ou teto:
    **bloqueia a conta** e manda a reserva para `CONCILIACAO`, sem nunca deixar
    o saldo negativo;
  - `releaseReservation` — devolve `reserved`, restaurando disponível **e**
    exposição ao teto; o saldo não se move porque nunca foi debitado.
- `src/lib/credits/threshold.ts` — handler `credit.reconcile`, que ao vencer o
  limiar de 2 h **decide**, nunca reembolsa cego:
  - run ainda ativo → **renova** o limiar;
  - run comprovadamente nunca iniciado (`startAttemptedAt` nulo) → libera;
  - estado remoto ambíguo → **bloqueia** e manda para `CONCILIACAO`.
- `src/lib/credits/reconcile.ts` + `src/app/api/organizations/credits/route.ts` +
  `src/app/organizacao/creditos/page.tsx` — conciliação administrativa;
  permissão `credit:manage`.

**Testes**
- `tests/unit/credits-settle.test.ts`:
  - custo real menor devolve a diferença à disponibilidade;
  - custo real maior, com espaço, consome e ajusta;
  - custo real maior, **sem** espaço, bloqueia a conta, vai a `CONCILIACAO` e o
    saldo **não** fica negativo;
  - liberar restaura disponível e exposição ao teto juntos.
- `tests/unit/credits-threshold.test.ts` — as três decisões do vencimento; um
  teste afirma que **nenhum caminho libera automaticamente** sem prova de que
  não houve chamada paga.
- `tests/unit/credits-reconcile.test.ts` — conciliar exige `credit:manage`;
  auditoria e ajuste na mesma transação; conta bloqueada recusa nova geração.
- `tests/unit/credits-cross-org.test.ts` — **negativo:** reserva da organização A
  não é conciliável por ator da B; reserva não pode apontar para job de outra
  organização.

**Aceite** — `durationMs` do Cursor não é preço; nenhum caminho converte duração
em centavos. Vencer o limiar é gatilho de decisão, não desfecho.

**Janelas** — run mais longo que o limiar; provedor ambíguo no vencimento; custo
real acima do estimado.

---

### Commit 9 — `feat(codegen)`: porta v2, sem custo e com capacidades declaradas

**Arquivos**
- `src/lib/codegen/provider.ts` — v2: `start`, `poll`, `cancel`. **`estimateCost`
  não existe na porta** — preço é política local.
  Acrescenta capacidades declaradas, que decidem se repetir é permitido:
  ```ts
  readonly capabilities: {
    /** Chamar `start` duas vezes com a mesma chave não cria dois runs. */
    idempotentStart: boolean;
    /** `findRunByKey` responde o que existe para uma chave nossa. */
    reconcileByKey: boolean;
  };
  ```
- `src/lib/codegen/fake/fake-agent.ts` — determinística, progressão controlável.
- `src/lib/codegen/sandbox/` — **replay local de fixtures, sem HTTP**, mais
  `fixtures/sandbox/cursor/*.json` redigidas.
- `src/lib/codegen/registry.ts` — por modo; `DESLIGADO` recusa, `LIVE` lança.
- `tests/contract/agent-contract.ts` — suíte única.

**Testes**
- `tests/unit/codegen-falso.test.ts` e `tests/unit/codegen-sandbox.test.ts` — a
  mesma suíte nos dois modos: `start` devolve ref; `poll` progride; `cancel` é
  idempotente; `poll` depois de `cancel` não volta a executando; branch e PR só
  aparecem ao concluir.
- **Sandbox não faz HTTP:** com a guarda de rede ativa, a suíte passa; um teste
  afirma que o módulo não importa cliente HTTP algum.
- Varredura das fixtures por padrão de segredo.
- `getCodeGenerationProvider("cursor")` continua recusando.

**Aceite** — a porta não tem método de preço. `promoteToProduction` e afins
continuam ausentes.

---

### Commit 10 — `feat(codegen)`: isolamento por repositório

**Arquivos**
- `src/lib/codegen/isolation.ts` — `buildAgentScope({ repository })` com
  exatamente **um** repositório em `repos`, `workOnCurrentBranch: false`,
  `autoCreatePR: true`, sem MCP server, sem segredo do NOX OS nem da Vercel, rede
  em allowlist. Zero ou dois repositórios é recusado antes de qualquer chamada.

**Testes**
- `tests/unit/codegen-isolation.test.ts`:
  - **negativo:** escopo montado para o cliente A não contém o repositório de B;
    montar com os dois é recusado;
  - **negativo:** `AgentRunRef` de A não é consultável nem cancelável por ator da
    organização de B — recusa igual a inexistente;
  - o escopo carrega `purpose` de `SecretRef`, nunca valor resolvido;
  - `autoCreatePR` verdadeiro e `workOnCurrentBranch` falso, fixados por teste.

**Aceite** — o teste negativo entre organizações é a prova de que o isolamento é
do domínio, não do provedor.

---

### Commit 11 — `feat(geracao)`: iniciar sem repetir efeito remoto

O handler **carrega** a intenção; nunca cria outra.

**Arquivos**
- `prisma/schema.prisma` + migration aditiva — `GenerationRun.branch`,
  `.pullRequestUrl`, `.startAttemptedAt`, `.reservationId`.
- `src/lib/generation/start.ts` — handler de `generation.start`:
  1. carrega o `GenerationRun` pelo `generationRunId` do job; ausente é erro de
     programação, não caminho normal;
  2. exige provisionamento completo (ordem da Fase 3);
  3. **se `startAttemptedAt` já existe e `providerRunId` é nulo:** só repete se
     `capabilities.idempotentStart`; se `reconcileByKey`, consulta antes de
     decidir; caso contrário → `CONCILIACAO`, sem chamar nada;
  4. estima preço local; sem preço, recusa **antes** de reservar;
  5. reserva crédito e grava `startAttemptedAt` na **mesma transação**;
  6. chama `start`, grava `providerRunId`, agenda `generation.poll` com
     `pollDeadlineAt`.
- `src/lib/generation/poll.ts` — consulta e **registra fato**: progresso, branch,
  PR, e ao concluir cria a `SiteRevision` imutável com `commitSha`. Nenhuma
  transição de projeto aqui.

**Testes**
- `tests/unit/generation-start.test.ts`:
  - sem preço configurado, nada é reservado e nada é chamado;
  - sem crédito, `start` nunca é chamado;
  - falha ao gravar o run libera a reserva;
  - **janela do lease:** com `startAttemptedAt` gravado e `providerRunId` nulo,
    provedor sem `idempotentStart` nem `reconcileByKey` → `CONCILIACAO`, e
    `start` **não** é chamado;
  - o mesmo cenário com `idempotentStart` → repete;
  - o mesmo cenário com `reconcileByKey` → consulta e adota o run existente.
- `tests/unit/generation-poll.test.ts` — executando → `deferJob` sem consumir
  tentativa; concluído cria exatamente uma `SiteRevision`; repetir não cria
  outra; `pollDeadlineAt` estourado → `CONCILIACAO`.

**Aceite** — nenhuma operação paga sem reserva anterior, provado por teste que
falha a reserva e verifica que `start` nunca é chamado. Nenhum efeito remoto
repetido às cegas.

**Janelas** — morte entre reservar e chamar; entre chamar e gravar
`providerRunId`; entre concluir e gravar a revisão.

---

### Commit 12 — `feat(estados)`: transição de sistema e a barreira

Antecipado de propósito: os pollers dos commits 13 e 14 não podem aplicar
transições que ainda não existem.

**Arquivos**
- `src/lib/site-factory/states.ts` — `applySystemTransition(tx, …)`, único
  caminho para transições com `permission: null`.
- `src/lib/generation/barrier.ts` — `evaluateGenerationOutcome(facts)`. Só
  devolve sucesso quando os três fatos apontam para **a mesma `SiteRevision` e o
  mesmo `commitSha`**: agente concluído, check obrigatório bem-sucedido,
  deployment de preview `READY`. Qualquer divergência é "ainda não", não sucesso.

**Testes**
- `tests/unit/system-transition.test.ts` — só a orquestração aplica; ator humano
  continua recusado; mudança e auditoria na mesma transação.
- `tests/unit/generation-barrier.test.ts`:
  - os três fatos alinhados → `PREVIA_PRONTA`;
  - **check de outro commit** → não conclui;
  - **preview de outra revisão** → não conclui;
  - dois de três → não conclui;
  - agente concluído com check falhando → `FALHOU` com razão fechada;
  - a barreira é pura: não escreve, só decide.

**Aceite** — a barreira é o único lugar que autoriza `GERANDO → PREVIA_PRONTA`.

---

### Commit 13 — `feat(checks)`: checks do GitHub como fato

**Arquivos**
- `src/lib/providers/ports.ts` — `listChecks({ repo, ref })`; fake e sandbox
  implementam; contrato cobre.
- `src/lib/generation/checks.ts` — handler `checks.poll`: **registra o fato** do
  check `verify` (constante `REQUIRED_CHECK` da Fase 3) para o `commitSha` da
  revisão e chama a barreira. Pendente → `deferJob`.

**Testes**
- Contrato nos dois modos: pendente, em execução, sucesso, falha, ausente.
- `tests/unit/generation-checks.test.ts` — pendente reagenda sem consumir
  tentativa; falha registra o fato e a barreira decide; ausente além do prazo →
  `CONCILIACAO`; o nome do check vem de `REQUIRED_CHECK`, não de literal.

---

### Commit 14 — `feat(preview)`: preview da Vercel como fato

**Arquivos**
- `src/lib/generation/preview.ts` — handler `preview.poll`, reusando
  `listDeployments` e `chooseDeployment` da Fase 3 com o `commitSha` da revisão
  gerada. Grava `Deployment` ligado à `SiteRevision` e chama a barreira.

**Testes**
- `tests/unit/generation-preview.test.ts` — `READY` registra o fato;
  `BUILDING` → `deferJob`; `ERROR` registra e a barreira decide; nenhum
  deployment além do prazo → `CONCILIACAO`.
- **Negativo:** o poll de um projeto nunca lê deployment de outro; deployment de
  outra organização é recusado.

**Aceite** — `Deployment` aponta para `SiteRevision`, mantendo a regra de que
publicação futura aponta para revisão imutável com commit.

---

### Commit 15 — `feat(ui)`, aceleradores e runbook

**Arquivos**
- `src/app/projetos/[id]/geracao/page.tsx` — estado do run, `pollCount` e
  `attempts` separados na tela, último erro redigido, links de branch/PR/preview.
- `src/app/organizacao/fila/page.tsx` — jobs por estado, pausados, conciliação,
  cartas mortas, reprocessar.
- `src/lib/jobs/accelerators.ts` — ponto único onde webhook ou SSE apenas
  **antecipam** `runAfter` de um job já enfileirado.
- `docs/runbook-fila.md`.

**Testes**
- `tests/unit/accelerators.test.ts` — o acelerador nunca conclui um job, nunca
  cria um, e um sistema sem ele chega ao mesmo estado final, só mais devagar.
- Permissões nas duas telas.

---

### Commit 16 — `feat(habilitacao)`: entrada transacional e as travas

**Último commit, e o único que mexe nas travas.**

**Arquivos**
- `src/lib/generation/request.ts` — `requestGeneration(actor, siteProjectId)`
  numa transação só: cria o `GenerationRun` em `PENDENTE`, aplica
  `BRIEFING_PRONTO → GERANDO`, e enfileira o job com `generationRunId`,
  `idempotencyKey` e `concurrencyKey`.
- `src/app/api/projects/[id]/generate/route.ts`.
- `src/lib/site-factory/states.ts` — remove `GERANDO` de
  `STAGES_PENDING_ORCHESTRATOR`. `PUBLICANDO` **permanece**.
- `src/lib/integrations/modes.ts` — remove `cursor` de
  `PROVIDERS_PENDING_PHASE`; `MODES_AVAILABLE` continua sem `LIVE`.

**Testes**
- `tests/unit/generation-request.test.ts` — run, transição e job caem juntos;
  falha em qualquer um desfaz os três; **dois cliques criam um job só** e um
  `GenerationRun` só; projeto já em geração é recusado; projeto com geração
  anterior terminal aceita uma nova.
- `tests/unit/generation-e2e-falso.test.ts` — caminho inteiro em `FALSO`, com o
  consumidor rodando em ciclos: pedir → reservar → agente → poll → check →
  preview → barreira → `PREVIA_PRONTA`, e a reserva conciliada ao fim.
- O mesmo caminho em `SANDBOX`, com a guarda de rede ativa.
- Atualizar os testes da Fase 3 que fixam a lista de estados pendentes e a recusa
  do Cursor — a mudança tem que quebrá-los, de propósito.

**Aceite** — `LIVE` indisponível; `PUBLICANDO` fechado; caminho ponta a ponta
verde em `FALSO` e em `SANDBOX`.

---

## Estratégia de rollback

**Por commit.** `git revert` sem tocar no banco: migrations são aditivas e código
antigo nunca depende de coluna nova. Reverter o 16 fecha `GERANDO` e recusa o
Cursor de novo; jobs existentes drenam.

**Freio global.** `NOX_INTEGRATIONS=disabled` pausa os jobs dependentes de
provedor sem consumir tentativa — é botão de parada sem deploy, e depois do
commit 6 ele é seguro de manter ligado indefinidamente.

**Freio do consumidor.** Remover `crons` do `vercel.json`. Jobs param, não se
perdem.

**Migrations.** Nenhuma remove coluna ou tabela. Desfazer é migration nova que
compensa, nunca edição de migration aplicada.

**Créditos.** Reverter código não devolve saldo. Reserva viva não vira reembolso
automático: o limiar renovável decide, e o que já foi consumido passa pela
conciliação administrativa, com ator e registro.

---

## Runbook operacional (vira `docs/runbook-fila.md` no commit 15)

**Fila parada.** Conferir `crons` no `vercel.json` e o `CRON_SECRET`. Disparar
`POST /api/jobs/run` e ler o retorno.

**Job em `PAUSADO`.** É o freio global ou o provedor desligado. Nada foi punido:
`attempts` está intocado. Religar e esperar o próximo ciclo.

**Job travado em `EM_EXECUCAO`.** Lease de consumidor morto; a próxima passada
reclama. Se não reclamar, alguém está estendendo — procurar `leaseOwner`.

**Job com `pollCount` alto.** Espera normal, não falha. Conferir `pollDeadlineAt`
antes de intervir.

**Job em `CONCILIACAO`.** Resultado ambíguo. **Não reprocessar às cegas.**
Consultar o provedor para descobrir o que existe e decidir. É o estado que
existe para não repetir operação paga por timeout.

**Carta morta.** Ler `lastErrorCode` e o `correlationId`; o detalhe está no log,
nunca na linha. Corrigir a causa e reprocessar — zera tentativas, é auditado.

**Conta bloqueada.** Reserva não conciliada ou custo acima do previsto sem
espaço. Conciliar em `/organizacao/creditos`. Enquanto bloqueada, nenhuma geração
paga começa.

**Saldo não bate.** Disponível é `balance − reserved`; exposição ao teto é
`consumed + reserved`. Comparar com o `UsageLedger`. Saldo e ledger mudam na
mesma transação, então divergência significa escrita fora da aplicação.

---

## Verificação obrigatória a cada commit

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, e
`npx prisma migrate deploy` + `migrate status` **somente** contra o Postgres
local, com o host verificado antes. A guarda de rede permanece ativa e
auto-verificada. Árvore limpa ao fim de cada commit.

---

## Decisões em aberto

1. **Valor do preço por geração.** A política é local e configurável, e sem
   configuração a geração é recusada — isso está fechado. Falta o número, e onde
   ele mora: variável de ambiente por instalação, ou coluna por organização com
   tela. Precisa antes do commit 7.

2. **Prazo de `pollDeadlineAt` por tipo de job.** Proposta: 2 h para o agente,
   30 min para checks, 30 min para preview. São os números que decidem quando
   uma espera vira conciliação. Precisa antes do commit 3.

3. **Intervalo do Cron.** Proposta: a cada 5 min. Mais curto reduz latência e
   aumenta invocações; mais longo faz o oposto. Precisa antes do commit 5.

4. **Reagendamento da pausa.** Proposta: 5 min fixos enquanto o freio estiver
   ligado. Precisa antes do commit 6.

5. **Capacidades reais do Cursor.** O commit 11 se comporta de três formas
   diferentes conforme `idempotentStart` e `reconcileByKey`. O padrão seguro é
   ambos falsos — que leva a `CONCILIACAO`. Confirmar contra a API real muda a
   experiência, não a corretude.

---

## Bloqueadores pré-`LIVE`

Herdados da Fase 3, ainda abertos:

- **Validar contra a API real o campo `link` da Vercel e o `template_repository`
  do GitHub no primeiro repositório descartável.** Toda a lógica de proveniência
  depende deles.
- Organização exclusiva do GitHub, com os dois Apps e escopos conferidos.
- Convenções de nome de repositório e de projeto Vercel não confirmadas.
- `NOX_SITE_TEMPLATE_COMMIT`, `NOX_SITE_KIT_VERSION`, `NOX_SITE_KIT_SHA256`
  apontando para artefatos reais.
- O SQL manual do `SecretRef` a reler antes da próxima migration — agora com os
  índices parciais do `Job` e o `CHECK` do `CreditAccount` na mesma situação.

Novos desta fase:

- **Conta e credencial do Cursor**, com `SecretRef` próprio, e confirmação de que
  a API expõe run id, estado, branch e PR.
- **Capacidades de idempotência do Cursor.** Sem `idempotentStart` nem
  `reconcileByKey`, toda ambiguidade vira trabalho humano — operável, mas caro em
  atenção.
- **Preço por run verificável.** Enquanto não existir, a política local é
  estimativa e a conciliação é administrativa.
- **`CRON_SECRET` na Vercel**, e confirmação de que o Cron envia o cabeçalho
  esperado.
- **Semântica de `FOR UPDATE SKIP LOCKED` no Postgres gerenciado.** Validado no
  local; um pooler em modo transação pode se comportar diferente, e isso precisa
  ser confirmado antes do primeiro consumidor em produção.
