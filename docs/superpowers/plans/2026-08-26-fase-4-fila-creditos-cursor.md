# Fase 4 — Fila durável, créditos e Cursor

> **Papel:** plano executável. É isto que se implementa.
> **Autoridade:** [spec da arquitetura-alvo](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> **Contexto:** [plano mestre das Fases 3 a 6](2026-08-25-fases-3-a-6-plano-mestre.md).
> **Pré-requisito:** Fase 3 aprovada e encerrada em `30645e7`.
> **Revisão 3** — corrige onze defeitos do desenho da revisão 2 e fixa os números.

**Objetivo:** dado um `SiteProject` provisionado, o NOX OS enfileira uma geração
de forma durável, reserva crédito antes de qualquer operação paga, orquestra o
Cursor Cloud Agent por polling, acompanha checks do GitHub e preview da Vercel, e
move o projeto de `GERANDO` para `PREVIA_PRONTA` ou `FALHOU` com base em fatos
verificados e persistidos.

## O que fica ligado ao fim da fase

Nada externo. Provedores em `DESLIGADO` (padrão), `FALSO` ou `SANDBOX`. Nenhuma
chamada paga, repositório remoto, projeto Vercel ou agente Cursor.

## Fora de escopo

Aprovação, publicação, promoção a produção, rollback de site, domínio e SSL —
Fase 5. Modo `LIVE` — Fase 6. Expurgo automático de jobs — decisão tomada, fica
fora. Webhook e SSE só como aceleradores (commit 15).

---

## O que mudou desde a revisão 2

A revisão 2 tinha defeitos que só apareceram ao seguir a cadeia inteira de ponta
a ponta. Nenhum é de redação.

| # | Defeito | Correção |
| --- | --- | --- |
| 1 | Uma `idempotencyKey` por geração, com índice único total — o segundo job da cadeia nunca poderia ser enfileirado | Chave **por etapa** |
| 2 | `requestGeneration` derivava a chave de um `GenerationRun` criado na mesma transação — dois cliques criavam dois runs com chaves diferentes | Idempotência **da requisição**, por entrada estável, **antes** do run |
| 3 | `concurrencyKey` de projeto em todos os jobs travava a própria cadeia | Exclusão só onde há mutação; observadores sem chave |
| 4 | "Agenda o próximo" sem dizer em qual transação nem o que acontece se falhar | Handoffs explícitos, na mesma transação do fato |
| 5 | A barreira lia um fato de check que não tinha onde morar | `GenerationCheck` durável |
| 6 | `IdempotencyKey` e `findRunByKey` existiam no texto e em nenhum commit | Commit 7 e commit 10 |
| 7 | `PAUSADO` entrava e não havia caminho de volta | Pausado é adquirível quando vence, e o freio decide de novo |
| 8 | `consumedThisMonthCents` nunca zerava | Rollover preguiçoso na própria reserva |
| 9 | FK dos dois lados entre run e reserva, livres para discordar | Uma direção só, única |
| 10 | Ledger só na reserva | Ledger em **toda** movimentação, com saldo posterior |
| 11 | Rollback de migration tratado como detalhe | Seção própria, com ordem de queda e pré-condições |

---

## Decisões fixadas

| Decisão | Valor |
| --- | --- |
| Cursor ao fim da fase | `FALSO` e `SANDBOX` no commit 16; `LIVE` continua fora |
| `SANDBOX` do Cursor | replay local de fixtures, sem HTTP |
| Consumidor | Vercel Cron, **a cada 5 minutos** |
| Retentativas de falha real | 5, base 30 s, teto 15 min, full jitter |
| `pollDeadlineAt` — agente | **2 h** |
| `pollDeadlineAt` — checks | **30 min** |
| `pollDeadlineAt` — preview | **30 min** |
| Reagendamento da pausa | **5 min** |
| Limiar da reserva | **2 h**, renovável |
| Preço | `CreditAccount.generationPriceCents`, **por organização**; nulo recusa a geração |
| Capacidades do Cursor | ambas **falsas** por padrão — ambiguidade vira conciliação |
| Expurgo de jobs | não existe na Fase 4 |

O **valor** do preço continua sendo dado, não desenho: quem opera define por
organização. O que o plano fixa é que sem ele não há geração.

---

## Princípios

**Espera não é falha.** Agente executando, check pendente e preview construindo
contam `pollCount` e respeitam `pollDeadlineAt`. Não consomem tentativa, não
aplicam backoff de falha, não caminham para carta morta. Estourar o prazo leva a
`CONCILIACAO`.

**Efeito remoto nunca é repetido às cegas.** `startAttemptedAt` antes da chamada.
Tentativa sem `providerRunId` só é repetida se o provedor declarar
`idempotentStart`; se declarar `reconcileByKey`, consulta antes de decidir. Sem
nenhuma das duas, `CONCILIACAO`.

**Nenhum job espera à toa.** O consumidor adquire um job por vez, sob demanda.

**Fato antes de decisão.** Cada etapa **persiste** o que observou. A barreira lê
fatos gravados e decide. Nada é inferido de memória de processo.

**`GERANDO` fecha até o commit 16.** `PUBLICANDO` permanece fechado — é Fase 5.
Os testes dos commits 12 a 14 constroem o estado em vez de transicionar para ele.

**Não existe worker em processo.** Serverless não sustenta laço vivo. O
consumidor é rota com orçamento, no formato de `runOverpassImportBurst(jobId,
budgetMs = 235_000)` com `maxDuration = 300`.

**`FOR UPDATE SKIP LOCKED` é SQL cru.** Prisma 5.22 não expressa; vai de
`$queryRaw`, com teste de integração próprio.

---

## A cadeia e seus handoffs

Quatro jobs, e o que importa é **quem enfileira quem, em qual transação**.

| Job | Faz | Persiste | Enfileira, na mesma transação |
| --- | --- | --- | --- |
| `generation.start` | reserva crédito, chama o agente | `startAttemptedAt`, `providerRunId` | `generation.poll` |
| `generation.poll` | consulta o agente | progresso; ao concluir, `SiteRevision` com `commitSha`, `branch`, `pullRequestUrl` | `checks.poll` **e** `preview.poll` |
| `checks.poll` | consulta o check `verify` | `GenerationCheck` | nada; chama a barreira |
| `preview.poll` | consulta o deployment | `Deployment` ligado à `SiteRevision` | nada; chama a barreira |

**A regra do handoff:** o job seguinte é criado na **mesma transação** que grava
o fato que o justifica. Se a transação falhar, nem o fato nem o job existem, e a
retentativa refaz os dois.

**A janela que isso deixa aberta, e como ela fecha.** O efeito remoto sobrevive à
transação: o agente já foi disparado, a revisão já existe no repositório. A
retentativa não repete o efeito — encontra `providerRunId` já gravado e **pula
direto para o handoff**. Cada handler começa perguntando "o que já está feito
aqui?" antes de fazer qualquer coisa. É o mesmo desenho da Fase 3, agora entre
etapas.

`checks.poll` e `preview.poll` são **irmãos, não sequenciais**. Rodam em qualquer
ordem, em qualquer ciclo do consumidor, e cada um chama a barreira ao terminar.
Quem chegar por último encontra os três fatos e conclui.

---

## Modelo de dados

Migrations aditivas, validadas apenas no PostgreSQL local.

### Job

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

  // generation.start | generation.poll | checks.poll | preview.poll | credit.threshold
  kind           String
  // PENDENTE | EM_EXECUCAO | PAUSADO | CONCILIACAO | CONCLUIDO | FALHOU | CARTA_MORTA
  status         String   @default("PENDENTE")

  /// Identifica **uma etapa** de um trabalho lógico. Ver a tabela de chaves.
  idempotencyKey String
  /// Só para trabalho que muta. Nulo para observadores, que não se excluem.
  concurrencyKey String?

  payloadJson    String

  attempts       Int      @default(0)
  maxAttempts    Int      @default(5)
  pollCount      Int      @default(0)
  pollDeadlineAt DateTime?

  runAfter       DateTime @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
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

### As chaves, por etapa

| `kind` | `idempotencyKey` | `concurrencyKey` |
| --- | --- | --- |
| `generation.start` | `gen:<runId>:start` | `project:<siteProjectId>` |
| `generation.poll` | `gen:<runId>:poll` | `null` |
| `checks.poll` | `checks:<runId>:<commitSha>` | `null` |
| `preview.poll` | `preview:<runId>:<commitSha>` | `null` |
| `credit.threshold` | `credit:<reservationId>` | `null` |

A chave de checks e preview inclui o `commitSha` de propósito: uma revisão nova
do mesmo run é **outro fato a observar**, não a mesma observação repetida.

Só `generation.start` é exclusivo. Ele é o único que muta — reserva crédito e
dispara o agente. Os outros observam, e travar observadores por projeto era
exatamente o que impedia a cadeia de andar.

**A exclusão de uma segunda geração não vem da fila.** Vem do estado: o portão de
elegibilidade da Fase 3 exige `BRIEFING_PRONTO`, e um projeto em `GERANDO` não
está. A `concurrencyKey` cobre a janela curta entre enfileirar e transicionar.

```sql
-- Uma etapa, um job, para sempre.
CREATE UNIQUE INDEX "Job_idempotency_uniq"
    ON "Job" ("organizationId", "idempotencyKey");

-- Um job mutante ativo por projeto. Observadores têm chave nula e não entram.
CREATE UNIQUE INDEX "Job_concurrency_ativo_uniq"
    ON "Job" ("concurrencyKey")
    WHERE "concurrencyKey" IS NOT NULL
      AND "status" IN ('PENDENTE', 'EM_EXECUCAO', 'PAUSADO', 'CONCILIACAO');
```

Escritos à mão — o Prisma não expressa índice parcial. O schema leva a anotação,
como o `SecretRef` da Fase 3, e o teste de drift confere que o próximo diff sai
vazio.

### Idempotência de requisição

```prisma
model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  /// generation.request | ...
  scope          String
  key            String
  requestHash    String
  // EM_ANDAMENTO | CONCLUIDA
  status         String   @default("EM_ANDAMENTO")
  /// LOCAL — trabalho puro; expirar autoriza assumir.
  /// EXTERNO_RECONCILIAVEL — o provedor responde o que existe para a chave.
  /// EXTERNO_AMBIGUO — expirar **não** autoriza repetir; vai a conciliação.
  sideEffect     String   @default("EXTERNO_AMBIGUO")
  responseJson   String?
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, scope, key])
  @@index([status, expiresAt])
}
```

A chave da requisição de geração é derivada de **entrada estável**:
`<siteProjectId>:<currentBriefVersionId>`, escopo `generation.request`. Dois
cliques no mesmo projeto, com o mesmo briefing, produzem a mesma chave — e é isso
que faz o segundo devolver o primeiro run em vez de criar outro. A chave da
revisão 2 era derivada do `GenerationRun`, que só existe depois; não podia
deduplicar o que a criava.

`generation.request` é `LOCAL`: criar run, transicionar e enfileirar são escritas
nossas, numa transação, integralmente reconciliáveis. É o único escopo que pode
ser assumido por vencimento sem risco.

### Fato do check

```prisma
/// O que o provedor respondeu sobre um check, gravado para a barreira ler.
model GenerationCheck {
  id             String   @id @default(cuid())
  siteRevisionId String
  siteRevision   SiteRevision @relation(fields: [siteRevisionId], references: [id], onDelete: Cascade)
  /// Redundante com a revisão de propósito: a barreira confere os dois.
  commitSha      String
  /// `verify`, de REQUIRED_CHECK.
  name           String
  // PENDENTE | EM_EXECUCAO | SUCESSO | FALHA | AUSENTE
  conclusion     String
  externalId     String?
  observedAt     DateTime @default(now())

  @@unique([siteRevisionId, name])
  @@index([commitSha])
}
```

Sem esta tabela a barreira da revisão 2 lia um fato que não existia em lugar
nenhum.

### Créditos

```prisma
model CreditAccount {
  organizationId       String   @id
  organization         Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  /// Tudo que a organização tem. Reserva não desconta daqui.
  balanceCents         Int      @default(0)
  /// Comprometido em reservas vivas. Disponível = balance − reserved.
  reservedCents        Int      @default(0)
  /// Gasto no período. Exposição ao teto = consumed + reserved.
  consumedThisMonthCents Int    @default(0)
  monthlyCapCents      Int      @default(0)
  /// Início do período vigente. O rollover avança isto.
  periodStartedAt      DateTime @default(now())

  /// Preço por geração. Nulo significa não configurado, e recusa a geração.
  generationPriceCents Int?

  blockedAt            DateTime?
  blockedReasonCode    String?

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  reservations CreditReservation[]
  ledger       CreditLedgerEntry[]
}

model CreditReservation {
  id              String   @id @default(cuid())
  organizationId  String
  account         CreditAccount @relation(fields: [organizationId], references: [organizationId], onDelete: Cascade)

  /// Uma reserva por operação — `generation:<generationRunId>`.
  operationKey    String
  jobId           String?
  job             Job? @relation(fields: [jobId], references: [id], onDelete: SetNull)
  /// **A única** ligação entre run e reserva. GenerationRun não aponta de volta.
  generationRunId String?  @unique
  generationRun   GenerationRun? @relation(fields: [generationRunId], references: [id], onDelete: SetNull)

  amountCents     Int
  // RESERVADA | CONSUMIDA | LIBERADA | CONCILIACAO
  status          String   @default("RESERVADA")
  estimatedBy     String
  reconciledCents Int?
  reconciledById  String?
  reconciledAt    DateTime?
  /// Limiar renovável. Vencer não libera nada por si só.
  expiresAt       DateTime
  renewedAt       DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  ledger          CreditLedgerEntry[]

  @@unique([organizationId, operationKey])
  @@index([organizationId, status])
  @@index([status, expiresAt])
}

/// Toda movimentação. Sem exceção.
model CreditLedgerEntry {
  id             String   @id @default(cuid())
  organizationId String
  account        CreditAccount @relation(fields: [organizationId], references: [organizationId], onDelete: Cascade)
  reservationId  String?
  reservation    CreditReservation? @relation(fields: [reservationId], references: [id], onDelete: SetNull)

  // RESERVA | CONSUMO | LIBERACAO | AJUSTE | BLOQUEIO | ROLLOVER | APORTE
  movement       String
  /// Assinado. Reserva não move saldo e grava zero, com os "depois" contando a
  /// história.
  amountCents    Int
  balanceAfterCents  Int
  reservedAfterCents Int
  consumedAfterCents Int

  /// Razão de conjunto fechado, nunca texto de provedor.
  reasonCode     String
  actorId        String?
  actor          User? @relation(fields: [actorId], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())

  @@index([organizationId, createdAt])
  @@index([reservationId])
}
```

Gravar os três "depois" em cada linha é o que torna o saldo reconstruível sem
recalcular a série inteira, e o que faz uma divergência apontar a linha exata em
que ela apareceu.

`UsageLedger` continua registrando **uso** — execuções, deploys. `CreditLedgerEntry`
registra **dinheiro**. Misturar os dois foi o que a revisão 2 fez ao gravar uma
linha de uso na reserva.

`GenerationRun` ganha colunas nulas e aditivas: `branch`, `pullRequestUrl`,
`startAttemptedAt`, `providerIdempotencyKey`. **Não** ganha `reservationId` — a
ligação é única e vive na reserva.

### Invariantes no banco

```sql
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_nao_negativo_ck"
    CHECK ("balanceCents" >= 0
       AND "reservedCents" >= 0
       AND "consumedThisMonthCents" >= 0
       AND "reservedCents" <= "balanceCents");
```

---

## Sequência de commits

### Commit 1 — `feat(fila)`: modelo, outbox e chaves por etapa

**Arquivos** — `prisma/schema.prisma` (`Job` com FKs), migration com os dois
índices escritos à mão, `src/lib/jobs/kinds.ts` (incluindo
`ACTIVE_JOB_STATUSES`, a mesma lista do índice parcial),
`src/lib/jobs/keys.ts` (a tabela de chaves acima, uma função por `kind`),
`src/lib/jobs/payload.ts` (allowlist), `src/lib/jobs/outbox.ts`
(`enqueueJob(tx, …)` exigindo transação).

**Testes**
- `jobs-keys.test.ts` — cada `kind` produz chave própria; a mesma etapa do mesmo
  run repete a chave; etapas diferentes **não** colidem; `checks`/`preview` de
  commits diferentes produzem chaves diferentes; observadores recebem
  `concurrencyKey` nula.
- `jobs-outbox-db.test.ts` — contra o Postgres local:
  - **a cadeia inteira cabe:** `start`, `poll`, `checks` e `preview` do mesmo run
    coexistem — o teste que a revisão 2 teria reprovado;
  - duplicar uma etapa devolve o job existente;
  - segundo job **mutante** para o projeto ativo é recusado;
  - observador não é recusado por haver mutante ativo;
  - com o mutante terminal, um novo mutante entra;
  - `CONCILIACAO` bloqueia novo mutante.
- `jobs-cross-org-db.test.ts` — **negativo:** job de A referenciando projeto de B
  é recusado pelo serviço; o teste diz explicitamente que a FK sozinha não
  protege.
- Drift: `migrate diff` vazio apesar do índice parcial.

**Janelas** — dois cliques; duas abas.

---

### Commit 2 — `feat(fila)`: aquisição com lease

**Arquivos** — `src/lib/jobs/claim.ts` (`claimJob` devolvendo **um**, com
`$queryRaw` e `FOR UPDATE SKIP LOCKED`; **não** incrementa `attempts`),
`src/lib/jobs/heartbeat.ts`.

Adquirível é `PENDENTE` **ou** `PAUSADO` com `runAfter` vencido — a retomada do
pausado nasce aqui, e o freio decide de novo no commit 6.

**Testes** — dois consumidores não pegam o mesmo job; `runAfter` futuro não é
pego; lease vivo não é pego; adquirir não mexe em `attempts`; `extendLease` de
outro dono não faz nada; **`PAUSADO` vencido é adquirível**.

**Janelas** — dois crons simultâneos; consumidor lento.

---

### Commit 3 — `feat(fila)`: cinco desfechos

**Arquivos** — `src/lib/jobs/outcomes.ts` (`completeJob`, `deferJob`,
`pauseJob`, `failJobRecoverable`, `failJobPermanent`),
`src/lib/jobs/backoff.ts` (full jitter, `random(0, min(15min, 30s · 2^n))`).

Só `failJobRecoverable` incrementa `attempts`. `deferJob` conta `pollCount` e
respeita `pollDeadlineAt` — estourar leva a `CONCILIACAO`. `pauseJob` não conta
nada.

**Testes** — cem `deferJob` deixam `attempts` em zero; prazo estourado vai a
`CONCILIACAO` e não a carta morta; terminal libera a `concurrencyKey`, provado
por um segundo `enqueueJob` que passa; cada formato de segredo da Fase 3 some de
`lastError`.

**Janelas** — agente longo; check demorado; provedor lento.

---

### Commit 4 — `feat(fila)`: reconciliação de lease e carta morta

**Arquivos** — `src/lib/jobs/reconcile.ts` (`reclaimExpiredLeases` preservando
`attempts` e `pollCount`), `src/lib/jobs/dead-letter.ts`, permissões `job:read`
e `job:run`.

**Testes** — lease vencido volta e contadores ficam; reprocessar exige `job:run`
e é auditado na mesma transação; reprocessar não fura a `concurrencyKey`.

**Janelas** — consumidor morre com lease; carta morta reprocessada em paralelo.

---

### Commit 5 — `feat(fila)`: consumidor sob demanda

**Arquivos** — `src/lib/jobs/consumer.ts` (`runJobBatch` adquirindo **um por
vez**), `src/app/api/jobs/run/route.ts` (`maxDuration = 300`,
`budgetMs = 235_000`), `vercel.json` com cron **a cada 5 min**,
`src/lib/jobs/cron-auth.ts`.

**Testes** — com orçamento para dois e cinco na fila, três permanecem
adquiríveis **sem lease**; orçamento estourado encerra sem adquirir; handler que
lança não derruba o ciclo; `CRON_SECRET` errado → 401; manual sem `job:run` →
403.

**Janelas** — cron dispara sobre o anterior; orçamento estoura no meio.

---

### Commit 6 — `feat(fila)`: freio global, pausa e retomada

**Arquivos** — `src/lib/jobs/gate.ts`. Antes de um handler dependente de
provedor, resolve o modo efetivo; `DESLIGADO` — por banco ou por
`NOX_INTEGRATIONS=disabled` — resulta em `pauseJob` com reagendamento de **5
min**. Declaração por `kind` de qual provedor cada um depende;
`credit.threshold` não depende de nenhum.

**A retomada é o par da pausa:** o job volta a ser adquirível quando `runAfter`
vence (commit 2), o freio é reavaliado, e ou executa ou pausa de novo. Não há
reconciliador separado, e não há como um job pausado ficar esquecido.

**Testes**
- freio ligado → `PAUSADO`, `attempts` em zero, sem `lastError`, sem backoff;
- **mil ciclos com o freio ligado não produzem nenhuma carta morta**;
- **religando, o job executa no ciclo seguinte** — a retomada, provada;
- jobs sem dependência de provedor continuam executando com o freio ligado.

**Janelas** — freio ligado durante um run; ligado e desligado entre ciclos; freio
ligado por semanas.

---

### Commit 7 — `feat(idempotencia)`: chave escopada e classificação de efeito

O commit que a revisão 2 perdeu.

**Arquivos** — `prisma/schema.prisma` + migration (`IdempotencyKey` com FK),
`src/lib/jobs/idempotency.ts` — `withIdempotency({ organizationId, scope, key,
requestHash, sideEffect, ttlMs }, work)`.

**Testes** (contra o Postgres local)
- duas organizações com a mesma chave não colidem;
- segunda chamada com o mesmo corpo devolve a resposta gravada sem reexecutar;
- mesma chave com corpo diferente → 409, sempre;
- `EM_ANDAMENTO` **não** vencida responde "em andamento", não duplica;
- `EM_ANDAMENTO` vencida com `sideEffect = LOCAL` **é assumida**;
- `EM_ANDAMENTO` vencida com `EXTERNO_AMBIGUO` → **`CONCILIACAO`**, nunca
  repetição;
- `EXTERNO_RECONCILIAVEL` vencida consulta antes de decidir;
- a resposta gravada passa pela allowlist.

**Janelas** — morte depois de reservar a chave e antes de gravar a resposta.

---

### Commit 8 — `feat(creditos)`: preço, conta, ledger, rollover e reserva

**Arquivos**
- `src/lib/credits/pricing.ts` — **política local pura**, sem rede e sem segredo.
  Lê `CreditAccount.generationPriceCents`; nulo lança `PRECO_NAO_CONFIGURADO`.
- `prisma/schema.prisma` + migration — `CreditAccount`, `CreditReservation`,
  `CreditLedgerEntry`, FKs e o `CHECK`.
- `src/lib/credits/period.ts` — `rolloverIfDue(tx, account)`: se
  `periodStartedAt` é de período anterior, zera `consumedThisMonthCents`, avança
  `periodStartedAt` e grava linha `ROLLOVER` no ledger. **Não toca em
  `reservedCents`** — reserva viva atravessa a virada.
- `src/lib/credits/reserve.ts` — `reserveCredits(tx, …)`: rollover primeiro, na
  mesma transação, e depois um `UPDATE` condicional:

  ```sql
  UPDATE "CreditAccount"
     SET "reservedCents" = "reservedCents" + $amount
   WHERE "organizationId" = $org
     AND "blockedAt" IS NULL
     AND "balanceCents" - "reservedCents" >= $amount
     AND "consumedThisMonthCents" + "reservedCents" + $amount <= "monthlyCapCents"
  ```

  Zero linhas significa que não cabe. Reserva, linha de ledger e `UsageLedger`
  vão na mesma transação.

O rollover é **preguiçoso, na escrita**, não por cron: um mês sem geração
nenhuma não deixa dívida acumulada, e não há como "perder" a virada porque o cron
falhou.

**Testes**
- `credits-pricing.test.ts` — sem preço, recusa **antes** de qualquer reserva; o
  módulo não importa rede nem `SecretRef` — teste que varre os imports.
- `credits-period.test.ts` — vira quando devido e só uma vez, mesmo com duas
  reservas concorrentes; **não** mexe em `reservedCents`; grava `ROLLOVER`;
  reserva feita antes da virada continua viva depois dela.
- `credits-db.test.ts` — disponível é `balance − reserved`; exposição é
  `consumed + reserved`; conta bloqueada não reserva; N concorrentes com espaço
  para N−1 deixam uma de fora; mesma `operationKey` produz uma reserva só; falha
  ao gravar o ledger desfaz o saldo; o `CHECK` recusa negativo.
- `credits-ledger.test.ts` — **toda** movimentação grava linha, e os três
  "depois" batem com a conta em cada uma.

**Janelas** — duas gerações com espaço para uma; virada de mês no meio de um run;
morte entre mover a conta e gravar o ledger.

---

### Commit 9 — `feat(creditos)`: liquidação, limiar renovável e conciliação

**Arquivos**
- `src/lib/credits/settle.ts` — `consumeReservation` (`reserved −= reservado`,
  `balance −= real`, `consumed += real`); real acima da reserva **sem espaço**
  bloqueia a conta e manda para `CONCILIACAO`, sem nunca deixar saldo negativo.
  `releaseReservation` devolve `reserved`, restaurando disponível **e** exposição.
  Ambas gravam ledger.
- `src/lib/credits/threshold.ts` — handler `credit.threshold`, que ao vencer as
  2 h **decide**: run ativo → renova; `startAttemptedAt` nulo → libera; ambíguo →
  bloqueia e concilia.
- `src/lib/credits/reconcile.ts`, `src/app/api/organizations/credits/route.ts`,
  `src/app/organizacao/creditos/page.tsx`, permissão `credit:manage`.

**Testes** — as três decisões do vencimento; **nenhum caminho libera sem prova de
que não houve chamada paga**; real maior sem espaço bloqueia e não fica negativo;
liberar restaura os dois números juntos; conciliar exige `credit:manage` e é
auditado na mesma transação; **negativo:** reserva de A não é conciliável por
ator de B, e reserva não aponta para job de outra organização.

**Janelas** — run mais longo que o limiar; ambiguidade no vencimento; custo real
acima do estimado.

---

### Commit 10 — `feat(codegen)`: porta v2, chave e reconciliação

**Arquivos** — `src/lib/codegen/provider.ts`:

```ts
start(input: { …, idempotencyKey: string }): Promise<AgentRunRef>;
poll(ref: AgentRunRef): Promise<AgentRunStatus>;
cancel(ref: AgentRunRef): Promise<void>;
/** Só faz sentido com capabilities.reconcileByKey. */
findRunByKey(key: string): Promise<AgentRunRef | null>;

readonly capabilities: {
  idempotentStart: boolean;
  reconcileByKey: boolean;
};
```

Não há `estimateCost` — preço é política local. A chave que mandamos é gravada em
`GenerationRun.providerIdempotencyKey`, e é ela que `findRunByKey` recebe.

Mais `fake/fake-agent.ts`, `sandbox/` (replay local de fixtures, **sem HTTP**),
`registry.ts` por modo, `tests/contract/agent-contract.ts`.

**Testes** — a mesma suíte em `FALSO` e `SANDBOX`: `start` devolve ref; `poll`
progride; `cancel` é idempotente; branch e PR só ao concluir.
**`findRunByKey`:** devolve o run criado com aquela chave; devolve nulo para
chave desconhecida; num provedor sem `reconcileByKey`, o contrato exige que
lançar seja o comportamento, não devolver nulo — nulo mentiria "não existe".
Sandbox não importa cliente HTTP algum. Fixtures varridas por padrão de segredo.
`getCodeGenerationProvider("cursor")` continua recusando.

---

### Commit 11 — `feat(codegen)`: isolamento por repositório

**Arquivos** — `src/lib/codegen/isolation.ts`: exatamente **um** repositório em
`repos`, `workOnCurrentBranch: false`, `autoCreatePR: true`, sem MCP server, sem
segredo do NOX OS nem da Vercel, rede em allowlist. Zero ou dois é recusado antes
de qualquer chamada.

**Testes** — **negativo:** escopo de A não contém o repositório de B, e montar
com os dois é recusado; **negativo:** `AgentRunRef` de A não é consultável nem
cancelável por ator de B; o escopo carrega `purpose`, nunca valor resolvido;
`autoCreatePR` e `workOnCurrentBranch` fixados por teste.

---

### Commit 12 — `feat(geracao)`: iniciar, acompanhar e passar adiante

**Arquivos** — migration aditiva (`GenerationRun.branch`, `.pullRequestUrl`,
`.startAttemptedAt`, `.providerIdempotencyKey`), `src/lib/generation/start.ts`,
`src/lib/generation/poll.ts`.

`start` **carrega** o run pelo `generationRunId` do job; ausência é erro de
programação. Em ordem: provisionamento completo → **se já há `providerRunId`,
pula direto para o handoff** → se há `startAttemptedAt` sem `providerRunId`,
decide pelas capacidades (repete, consulta ou `CONCILIACAO`) → preço → reserva e
`startAttemptedAt` na mesma transação → `start` → grava `providerRunId` **e
enfileira `generation.poll` na mesma transação**.

`poll` observa e persiste. Ao concluir, cria a `SiteRevision` imutável **e
enfileira `checks.poll` e `preview.poll` na mesma transação**. Nenhuma transição
de projeto aqui.

**Testes**
- sem preço, nada é reservado nem chamado;
- sem crédito, `start` nunca é chamado;
- falha ao gravar o run libera a reserva;
- **janela do lease:** `startAttemptedAt` sem `providerRunId`, provedor sem as
  duas capacidades → `CONCILIACAO` e `start` **não** é chamado; com
  `idempotentStart` → repete; com `reconcileByKey` → `findRunByKey` e adota;
- **handoff:** falha ao enfileirar `generation.poll` desfaz a gravação do
  `providerRunId`, e a retentativa encontra o run pelo provedor em vez de
  disparar outro;
- **retomada pós-handoff:** com `providerRunId` já gravado, a retentativa não
  chama `start` e enfileira o poll;
- `poll` executando → `deferJob` sem consumir tentativa; concluído cria **uma**
  `SiteRevision` e **dois** jobs irmãos; repetir não cria segunda revisão nem
  jobs duplicados (chaves por etapa); prazo de 2 h estourado → `CONCILIACAO`.

**Janelas** — morte entre reservar e chamar; entre chamar e gravar
`providerRunId`; entre gravar e enfileirar o poll; entre concluir e enfileirar os
irmãos.

---

### Commit 13 — `feat(estados)`: transição de sistema, fato do check e barreira

Antecipado de propósito: os pollers do commit 14 não podem aplicar transições nem
gravar fatos que ainda não existem.

**Arquivos** — `prisma/schema.prisma` + migration (`GenerationCheck`),
`src/lib/site-factory/states.ts` (`applySystemTransition`),
`src/lib/generation/barrier.ts` (`evaluateGenerationOutcome`).

A barreira é **pura**: recebe os três fatos lidos do banco e decide. Só conclui
quando os três apontam para a **mesma `SiteRevision` e o mesmo `commitSha`**.

**Testes** — só a orquestração aplica transição de sistema; ator humano continua
recusado; mudança e auditoria na mesma transação. Barreira: três alinhados →
`PREVIA_PRONTA`; **check de outro commit** → não conclui; **preview de outra
revisão** → não conclui; dois de três → não conclui; check falhando → `FALHOU`
com razão fechada; a barreira não escreve.

---

### Commit 14 — `feat(observadores)`: checks e preview como fato

**Arquivos** — `src/lib/providers/ports.ts` (`listChecks`), fake e sandbox,
`src/lib/generation/checks.ts` (grava `GenerationCheck`, prazo **30 min**),
`src/lib/generation/preview.ts` (grava `Deployment` ligado à `SiteRevision`,
prazo **30 min**). Cada um chama a barreira ao terminar, na mesma transação do
fato.

**Testes** — contrato de `listChecks` nos dois modos; pendente → `deferJob` sem
consumir tentativa; falha grava o fato e a barreira decide; ausente além de 30
min → `CONCILIACAO`; o nome vem de `REQUIRED_CHECK`.
**Irmãos:** rodando em qualquer ordem, o último a gravar conclui; rodando duas
vezes, não duplicam fato (`@@unique([siteRevisionId, name])`).
**Negativo:** o poll de um projeto nunca lê deployment de outro; deployment de
outra organização é recusado.

---

### Commit 15 — `feat(ui)`, aceleradores e runbook

**Arquivos** — `src/app/projetos/[id]/geracao/page.tsx` (com `pollCount` e
`attempts` **separados** na tela), `src/app/organizacao/fila/page.tsx`,
`src/lib/jobs/accelerators.ts`, `docs/runbook-fila.md`.

**Testes** — o acelerador nunca conclui nem cria job, e um sistema sem ele chega
ao mesmo estado final, só mais devagar; permissões nas duas telas.

---

### Commit 16 — `feat(habilitacao)`: requisição idempotente e as travas

**Arquivos** — `src/lib/generation/request.ts`,
`src/app/api/projects/[id]/generate/route.ts`, e as duas travas:
`STAGES_PENDING_ORCHESTRATOR` perde `GERANDO` (`PUBLICANDO` permanece);
`PROVIDERS_PENDING_PHASE` perde `cursor` (`MODES_AVAILABLE` continua sem `LIVE`).

`requestGeneration(actor, siteProjectId)`, numa transação só, **nesta ordem**:

1. `withIdempotency` no escopo `generation.request`, chave
   `<siteProjectId>:<currentBriefVersionId>`, `sideEffect = LOCAL`;
2. cria o `GenerationRun` em `PENDENTE`;
3. aplica `BRIEFING_PRONTO → GERANDO`;
4. enfileira `generation.start` com `generationRunId`, chave de etapa e
   `concurrencyKey` de projeto.

A idempotência vem **antes** do run porque é ela que impede o segundo run de
existir. Depois do run seria tarde: a revisão 2 derivava a chave de uma linha
criada na mesma transação, e duas transações concorrentes gerariam duas chaves
diferentes.

**Testes**
- run, transição e job caem juntos; falha em qualquer um desfaz os três;
- **dois cliques simultâneos** produzem **um** `GenerationRun`, **um** job e a
  mesma resposta — executado com duas transações reais, concorrentes;
- clique repetido depois da conclusão, com **novo briefing**, cria uma geração
  nova; com o mesmo briefing, devolve a anterior;
- projeto em `GERANDO` é recusado pelo estado, não pela fila;
- `generation-e2e-falso.test.ts` — cadeia inteira com o consumidor em ciclos:
  pedir → reservar → agente → poll → dois irmãos → barreira → `PREVIA_PRONTA`, e
  a reserva conciliada ao fim;
- o mesmo em `SANDBOX`, com a guarda de rede ativa;
- os testes da Fase 3 que fixam a lista de estados pendentes e a recusa do Cursor
  quebram de propósito e são atualizados aqui.

**Aceite** — `LIVE` indisponível; `PUBLICANDO` fechado; cadeia verde em `FALSO` e
`SANDBOX`.

---

## Rollback

### Código

`git revert` do commit. Migrations são aditivas e o código antigo nunca lê coluna
nova, então reverter código com o banco à frente funciona. Reverter o 16 fecha
`GERANDO` e recusa o Cursor; jobs existentes drenam ou vão a carta morta.

### Freios sem deploy

`NOX_INTEGRATIONS=disabled` pausa os jobs dependentes de provedor sem consumir
tentativa — depois do commit 6 é seguro mantê-lo ligado indefinidamente. Remover
`crons` do `vercel.json` para o consumidor. Jobs param, não se perdem.

### Migrations

Nenhuma migration desta fase remove coluna, tabela ou índice. Desfazer é
**migration compensatória nova**, nunca edição de migration aplicada — a regra
que o `SecretRef` da Fase 3 já estabeleceu.

Cada compensação é escrita no commit que a origina, guardada em
`prisma/compensations/<nome>.sql`, **não aplicada**, e revisada antes de qualquer
uso. A ordem de queda é a inversa das dependências:

| Migration | Compensação derruba, nesta ordem | Pré-condição |
| --- | --- | --- |
| `fila_durable` | `Job_concurrency_ativo_uniq`, `Job_idempotency_uniq`, FKs, tabela | fila drenada; nenhum job vivo |
| `idempotencia` | índices, FK, tabela | nenhuma chave `EM_ANDAMENTO` |
| `creditos` | `CreditLedgerEntry`, `CreditReservation`, `CHECK`, `CreditAccount` | nenhuma reserva `RESERVADA` ou em `CONCILIACAO` |
| `geracao_colunas` | as quatro colunas de `GenerationRun` | nenhum run em andamento |
| `generation_check` | `@@unique`, FK, tabela | nenhuma barreira pendente |

**A pré-condição não é formalidade.** Derrubar `Job` com a fila viva perde
trabalho aceito e pago. Derrubar `CreditReservation` com reserva viva perde a
única prova de que um valor foi comprometido — e o dinheiro já saiu.

### Créditos

Reverter código não devolve saldo. Reserva viva não vira reembolso automático: o
limiar decide, e o consumido passa pela conciliação administrativa, com ator e
linha de ledger. O `CreditLedgerEntry` é o que permite reconstruir a conta
depois de qualquer reversão.

---

## Runbook (vira `docs/runbook-fila.md` no commit 15)

**Fila parada.** Conferir `crons` e `CRON_SECRET`. Disparar `POST /api/jobs/run`
e ler o retorno.

**Job em `PAUSADO`.** Freio global ou provedor desligado. Nada foi punido:
`attempts` intocado. Religar; o job volta sozinho no ciclo seguinte ao
vencimento dos 5 min.

**Job travado em `EM_EXECUCAO`.** Lease de consumidor morto; a próxima passada
reclama. Se não reclamar, alguém está estendendo — procurar `leaseOwner`.

**`pollCount` alto.** Espera normal. Conferir `pollDeadlineAt` antes de intervir.

**Job em `CONCILIACAO`.** Ambíguo. **Não reprocessar às cegas.** Consultar o
provedor — se houver `providerIdempotencyKey` e `reconcileByKey`, `findRunByKey`
responde o que existe. Decidir a partir do fato.

**Carta morta.** Ler `lastErrorCode` e o `correlationId`; o detalhe está no log,
nunca na linha. Corrigir a causa e reprocessar.

**Cadeia parada no meio.** Ver qual etapa tem job vivo. `start` concluído sem
`poll` significa handoff perdido — a retentativa do `start` reconhece o
`providerRunId` e reenfileira. Revisão criada sem os dois irmãos, idem.

**Conta bloqueada.** Reserva não conciliada, ou custo real acima do previsto sem
espaço. Conciliar em `/organizacao/creditos`.

**Saldo não bate.** Disponível é `balance − reserved`; exposição é
`consumed + reserved`. O `CreditLedgerEntry` grava os três "depois" em cada
linha: a divergência aponta a linha exata.

**Virada de mês.** O rollover é preguiçoso, na primeira reserva do período novo.
Um mês inteiro sem geração não vira dívida; a linha `ROLLOVER` aparece quando a
próxima reserva acontecer.

---

## Verificação obrigatória a cada commit

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, e
`npx prisma migrate deploy` + `migrate status` **somente** contra o Postgres
local, com o host verificado antes. Guarda de rede ativa e auto-verificada.
Árvore limpa.

---

## Decisões em aberto

Nenhuma de desenho. Restam **dados** que quem opera fornece:

1. **Valor de `generationPriceCents` por organização.** O plano fixa que sem ele
   não há geração; o número é operacional.
2. **`monthlyCapCents` por organização.** Mesma natureza.

---

## Bloqueadores pré-`LIVE`

Herdados da Fase 3:

- **Validar contra a API real o campo `link` da Vercel e o `template_repository`
  do GitHub no primeiro repositório descartável.**
- Organização exclusiva do GitHub, com os dois Apps e escopos conferidos.
- Convenções de nome de repositório e de projeto Vercel não confirmadas.
- `NOX_SITE_TEMPLATE_COMMIT`, `NOX_SITE_KIT_VERSION`, `NOX_SITE_KIT_SHA256`
  reais.
- SQL manual a reler antes de gerar migration: `SecretRef` da Fase 3, e agora os
  índices parciais do `Job`, o `CHECK` do `CreditAccount` e as compensações.

Novos desta fase:

- **Conta e credencial do Cursor**, com `SecretRef` próprio, e confirmação de que
  a API expõe run id, estado, branch e PR.
- **Capacidades reais de idempotência do Cursor.** O padrão é ambas falsas, que
  manda toda ambiguidade para trabalho humano — operável, caro em atenção. Saber
  se `findRunByKey` tem equivalente real muda muito o custo operacional.
- **Preço por run verificável.** Enquanto não existir, a política local é
  estimativa e a conciliação é administrativa.
- **`CRON_SECRET` na Vercel** e confirmação do cabeçalho enviado pelo Cron.
- **Semântica de `FOR UPDATE SKIP LOCKED` no Postgres gerenciado.** Validado no
  local; um pooler em modo transação pode se comportar diferente, e isso precisa
  ser confirmado antes do primeiro consumidor em produção.
