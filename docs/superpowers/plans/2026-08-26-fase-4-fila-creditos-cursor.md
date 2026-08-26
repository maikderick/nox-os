# Fase 4 — Fila durável, créditos e Cursor

> **Papel:** plano executável. É isto que se implementa.
> **Autoridade:** [spec da arquitetura-alvo](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> **Contexto:** [plano mestre das Fases 3 a 6](2026-08-25-fases-3-a-6-plano-mestre.md).
> **Pré-requisito:** Fase 3 aprovada e encerrada em `30645e7`.
> **Revisão 5** — a tentativa de início vira disposição fechada, e a reserva
> sobrevive à retentativa segura em vez de ser recriada.
>
> Revisão 4 — chave de idempotência do cliente, vencedor único por atualização
> condicional, destino da reserva em todo caminho, e a correção de como se
> desfaz um commit que já aplicou migration.

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

## O que mudou desde a revisão 3

| # | Defeito | Correção |
| --- | --- | --- |
| 1 | Chave de requisição derivada de projeto + briefing — não distinguia retentativa de rede de nova geração intencional | `Idempotency-Key` do cliente, UUID por intenção |
| 2 | `requestGeneration` só aceitava `BRIEFING_PRONTO` | Aceita todo estado com transição autorizada para `GERANDO` |
| 3 | Vencedor concorrente decidido pela fila | Atualização condicional do projeto: um vencedor, sempre |
| 4 | `credit.threshold` existia como `kind` e ninguém o enfileirava | Nasce com a reserva, na mesma transação; renovação é `deferJob` |
| 5 | O destino da reserva ficava implícito em alguns caminhos | Tabela de desfechos; nenhuma saída deixa reserva esquecida |
| 6 | `UsageLedger` na transação de reserva — uso misturado com dinheiro | Reserva só no `CreditLedgerEntry`; uso é gravado uma vez, na execução |
| 7 | Duas revisões podiam nascer do mesmo run sob lease expirado | `SiteRevision.generationRunId` único, com teste concorrente |
| 8 | Dois observadores terminando juntos podiam transicionar duas vezes | Atualização condicional `GERANDO → resultado`; um transiciona, o outro reconhece |
| 9 | `GenerationRun` sem o lado reverso da relação — não compila no Prisma | Campo reverso existe; a **FK** continua só em `CreditReservation` |
| 10 | Rollback proposto como `git revert` de commit com migration | Desativação por trava, ou migration compensatória posterior |
| 11 | Cron a cada 5 min tornava o backoff de 30 s decorativo | Cron a cada 1 min |

---

## O que mudou desde a revisão 4

| # | Defeito | Correção |
| --- | --- | --- |
| 1 | "Tentativa sem `providerRunId`" era inferido de `startAttemptedAt` e do erro — três situações diferentes lidas como uma | `GenerationRun.startDisposition`, domínio fechado, gravado antes da chamada |
| 2 | Falha segura antes do `start` liberava a reserva e a próxima tentativa criava outra — com outro `credit.threshold` | Mesma reserva permanece `RESERVADA` e é reutilizada; o vigia continua vivo |

---

## Decisões fixadas

| Decisão | Valor |
| --- | --- |
| Cursor ao fim da fase | `FALSO` e `SANDBOX` no commit 16; `LIVE` continua fora |
| `SANDBOX` do Cursor | replay local de fixtures, sem HTTP |
| Consumidor | Vercel Cron, **a cada 1 minuto** |
| Retentativas de falha real | 5, base 30 s, teto 15 min, full jitter |
| `pollDeadlineAt` — agente | **2 h** |
| `pollDeadlineAt` — checks | **30 min** |
| `pollDeadlineAt` — preview | **30 min** |
| Reagendamento da pausa | **5 min** (reavaliação do freio, independente do ciclo) |
| Limiar da reserva | **2 h**, renovável |
| Preço | `CreditAccount.generationPriceCents`, **por organização**; nulo recusa a geração |
| Capacidades do Cursor | ambas **falsas** por padrão — ambiguidade vira conciliação |
| `Idempotency-Key` | **obrigatória**, UUID por intenção, fornecida pelo cliente |
| Expurgo de jobs | não existe na Fase 4 |

O **valor** do preço continua sendo dado, não desenho: quem opera define por
organização. O que o plano fixa é que sem ele não há geração.

---

## Princípios

**Espera não é falha.** Agente executando, check pendente e preview construindo
contam `pollCount` e respeitam `pollDeadlineAt`. Não consomem tentativa, não
aplicam backoff de falha, não caminham para carta morta. Estourar o prazo leva a
`CONCILIACAO`.

**Efeito remoto nunca é repetido às cegas.** Quem decide isso é
`GenerationRun.startDisposition`, uma **disposição fechada** gravada antes da
chamada — nunca o texto de um erro. `EM_TENTATIVA` entra antes de qualquer byte
sair; morrer ali deixa exatamente o estado que se lê como ambíguo. Só um erro
interno tipado e seguro grava `SEM_EFEITO_COMPROVADO`, e só ele autoriza chamar
de novo. Ambíguo só é repetido se o provedor declarar `idempotentStart`; se
declarar `reconcileByKey`, consulta antes de decidir. Sem nenhuma das duas,
`CONCILIACAO`.

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

Cinco jobs, e o que importa é **quem enfileira quem, em qual transação**.

| Job | Faz | Persiste | Enfileira, na mesma transação |
| --- | --- | --- | --- |
| `generation.start` | reserva crédito, chama o agente | reserva, `startAttemptedAt`, `providerRunId` | `credit.threshold` (com a reserva) e `generation.poll` (com o `providerRunId`) |
| `generation.poll` | consulta o agente | progresso; ao concluir, `SiteRevision` com `commitSha`, `branch`, `pullRequestUrl` | `checks.poll` **e** `preview.poll` |
| `checks.poll` | consulta o check `verify` | `GenerationCheck` | nada; chama a barreira |
| `preview.poll` | consulta o deployment | `Deployment` ligado à `SiteRevision` | nada; chama a barreira |
| `credit.threshold` | vigia o limiar da reserva | renovação, liberação ou bloqueio | nada; `deferJob` em si mesmo ao renovar |

`credit.threshold` nasce **na mesma transação que a reserva**, com chave
`credit:<reservationId>`. Nasce junto de propósito: uma reserva criada sem
vigia é exatamente a reserva que fica esquecida. Renovar não cria job novo —
é `deferJob` no mesmo, que empurra `runAfter` sem consumir tentativa.

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
Quem chegar por último encontra os três fatos e conclui — e a seção da barreira
explica por que "por último" precisa ser decidido pelo banco, não pelo código.

### Desfechos

Toda linha existe. Nenhuma saída deixa reserva esquecida.

| Situação | Job | Projeto | `GenerationRun` | Reserva |
| --- | --- | --- | --- | --- |
| Falha **antes** de `start` — sem preço, sem crédito, preflight | `FALHOU` ou `CARTA_MORTA` | `FALHOU` | `FALHOU` | **liberada** (ou nunca criada) |
| `start` falhou em `SEM_EFEITO_COMPROVADO`, com tentativa sobrando | `PENDENTE` com backoff | `GERANDO` | `PENDENTE` | **mantida em `RESERVADA`**, reutilizada na próxima tentativa |
| Tentativas esgotadas, ainda em `SEM_EFEITO_COMPROVADO` | `CARTA_MORTA` | `FALHOU` | `FALHOU` | **liberada** |
| Run confirmado em execução, limiar vencido | `PENDENTE` via `deferJob` | `GERANDO` | `EXECUTANDO` | **renovada** |
| Agente concluiu, checks e preview verdes | `CONCLUIDO` | `PREVIA_PRONTA` | `CONCLUIDO` | **consumida** pelo preço configurado |
| Agente concluiu, check ou preview falhou | `CONCLUIDO`; o irmão vivo é **cancelado** | `FALHOU` | `CONCLUIDO` | **consumida** — o trabalho pago aconteceu |
| Prazo de poll estourado | `CONCILIACAO` | `GERANDO` | `EXECUTANDO` | **conciliação**, conta bloqueada |
| Efeito remoto ambíguo — `AMBIGUO`, ou `EM_TENTATIVA` reencontrado | `CONCILIACAO` | `GERANDO` | `PENDENTE` | **conciliação**, conta bloqueada |
| Custo real acima da reserva, sem espaço | `CONCLUIDO` | conforme a barreira | `CONCLUIDO` | **conciliação**, conta bloqueada |
| Carta morta por esgotar tentativas | `CARTA_MORTA` | `FALHOU` | `FALHOU` | **liberada** em `NAO_TENTADO` e `SEM_EFEITO_COMPROVADO`; **conciliação** nas demais |

Sucesso em `FALSO` e `SANDBOX` consome o preço configurado como qualquer
outro — o modo muda quem responde, não a contabilidade. Um caminho que não
cobrasse em modo falso deixaria a conciliação sem nada para comparar quando o
modo virasse.

As duas últimas linhas são a razão de a disposição existir. Uma carta morta
precisa distinguir "nunca chamou", "chamou e não pegou" e "chamou e não soube":
liberar na terceira é reembolsar trabalho que aconteceu, e conciliar na primeira
é mandar gente olhar o que não existe.

**A reserva atravessa a retentativa segura.** Em `SEM_EFEITO_COMPROVADO` com
tentativa sobrando, a reserva **não** é liberada e recriada: continua
`RESERVADA`, e a próxima tentativa reusa a mesma, pela mesma `operationKey`.
Liberar e recriar teria três defeitos — abriria uma janela em que o crédito pode
ser tomado por outra geração, criaria um segundo `credit.threshold` para a mesma
intenção, e encheria o ledger de pares liberação/reserva que não descrevem
movimento nenhum. O vigia que nasceu com a reserva continua vivo e continua
sendo o mesmo job.

**Não existe volta de `GERANDO` para o estado de origem.** A máquina de estados
da Fase 1 autoriza `GERANDO → PREVIA_PRONTA` e `GERANDO → FALHOU`, e nada mais.
Por isso a primeira linha termina em `FALHOU` mesmo quando nada chegou a ser
chamado: de lá quem opera volta ao briefing ou ao rascunho, por transições que
existem e são auditadas. Escrever "volta ao estado anterior", como a revisão 3
fazia, era inventar uma transição que a Fase 1 não tem — e que ficaria pior
agora, com cinco estados de partida possíveis.

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
  // EM_ANDAMENTO | CONCLUIDA | CONCILIACAO
  status         String   @default("EM_ANDAMENTO")
  /// Quem detém a execução, agora. Renovar `expiresAt` não é tomar posse:
  /// dois chamadores encontrando a mesma chave vencida renovariam os dois.
  ownerToken     String?
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

A chave da requisição de geração é **fornecida pelo cliente**, no cabeçalho
`Idempotency-Key`, como UUID **por intenção**. É obrigatória: sem ela a rota
responde `400`.

A revisão 3 derivava a chave de `<siteProjectId>:<currentBriefVersionId>`, e
isso confundia duas coisas diferentes. Uma retentativa de rede e um segundo
pedido deliberado do mesmo site, com o mesmo briefing, produziam a mesma chave —
então a segunda geração intencional era engolida como duplicata. Quem sabe a
diferença é o cliente: retentativa reusa a chave, intenção nova gera outra.

`requestHash` continua existindo, e agora tem função clara: mesma chave com
corpo diferente é quase certamente bug do chamador, e responde `409`.

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

`UsageLedger` continua registrando **uso** — execuções, deploys.
`CreditLedgerEntry` registra **dinheiro**. A revisão 3 ainda gravava uso na
transação da reserva, e isso está errado por dois motivos: reserva é movimento
financeiro, não execução; e reservar não é executar — um run que nunca começa
teria deixado uma linha de uso para uma execução que não houve.

`UsageLedger` passa a ser gravado **uma única vez, na execução**, com
`reference = <generationRunId>`. A referência é o que torna a escrita
idempotente: a retomada de um poll não soma uso duas vezes.

`GenerationRun` ganha colunas nulas e aditivas: `branch`, `pullRequestUrl`,
`startAttemptedAt`, `providerIdempotencyKey`. Ganha também o **lado reverso**
da relação — `reservation CreditReservation?` —, que o Prisma exige para
compilar. O que ele não ganha é **coluna de FK**: `reservationId` não existe,
e a única chave estrangeira continua sendo `CreditReservation.generationRunId`,
única. Campo reverso é leitura; FK é a verdade, e ela mora num lugar só.

`SiteRevision` ganha uma restrição, não uma coluna: `generationRunId` passa a ser
**único**. Um run produz uma revisão, e é o índice que sustenta isso quando dois
handlers do mesmo run concluem sob lease vencido. Aqui também a FK é de um lado
só — a revisão aponta para o run, nunca o contrário.

### Disposição da tentativa de início

`GenerationRun.startDisposition` é coluna aditiva, `NAO_TENTADO` por padrão, com
**domínio fechado**. Nenhum texto de provedor entra nela.

| Disposição | O que aconteceu | O que a retentativa pode fazer |
| --- | --- | --- |
| `NAO_TENTADO` | nada saiu daqui | chamar |
| `EM_TENTATIVA` | gravado **antes** da chamada; o processo pode ter morrido com ela em voo | tratar como ambíguo |
| `SEM_EFEITO_COMPROVADO` | erro interno tipado, anterior à chamada | chamar de novo, **com a mesma reserva** |
| `INICIADO` | `providerRunId` gravado | não chamar; seguir para o poll |
| `AMBIGUO` | erro desconhecido, ou efeito impossível de descartar | `CONCILIACAO` |

`startAttemptedAt` continua existindo, como carimbo de tempo. O que ele não faz
é decidir: "houve tentativa" não separa as três coisas que importam — não
chamou, chamou e não pegou, chamou e não soube.

**A janela do crash fecha porque `EM_TENTATIVA` é escrito antes.** Quem morre
com a chamada em voo não deixa silêncio para interpretar: deixa `EM_TENTATIVA`,
e a leitura dessa disposição é ambiguidade, não permissão para repetir.

**Só erro nosso, tipado, grava `SEM_EFEITO_COMPROVADO`** — preço não
configurado, crédito insuficiente, payload inválido, provedor não configurado,
tudo que acontece antes de qualquer byte sair. Timeout, erro de rede, resposta
que não se entende: `AMBIGUO`. A classificação olha o **tipo** do erro, nunca a
mensagem — a mesma regra de razões fechadas que a Fase 3 estabeleceu.

### Invariantes no banco

```sql
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_nao_negativo_ck"
    CHECK ("balanceCents" >= 0
       AND "reservedCents" >= 0
       AND "consumedThisMonthCents" >= 0
       AND "reservedCents" <= "balanceCents");

-- Domínio fechado no banco, não só no TypeScript.
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_disposicao_ck"
    CHECK ("startDisposition" IN ('NAO_TENTADO', 'EM_TENTATIVA',
        'SEM_EFEITO_COMPROVADO', 'INICIADO', 'AMBIGUO'));

-- `INICIADO` e `providerRunId` andam juntos, nos dois sentidos.
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_iniciado_ck"
    CHECK (("startDisposition" = 'INICIADO') = ("providerRunId" IS NOT NULL));
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
`budgetMs = 235_000`), `vercel.json` com cron **a cada 1 min**,
`src/lib/jobs/cron-auth.ts`.

Com ciclo de 1 min e orçamento de quase 4 min, disparos se sobrepõem **por
desenho** — e é isso que faz o backoff de 30 s significar 30 s. Quem sustenta a
sobreposição é o lease: cada job é adquirido por um consumidor só, e o disparo
seguinte não o encontra adquirível.

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

**Posse é token, não carimbo.** Renovar `expiresAt` não é tomar posse: dois
chamadores encontrando a mesma chave vencida renovavam os dois e executavam os
dois. Tomar posse escreve um `ownerToken` novo sob condição avaliada pelo
PostgreSQL — estado, vencimento e `NOW()` na mesma instrução que escreve —, e
concluir, liberar ou conciliar conferem esse token. Um executor cujo lugar foi
tomado não sobrescreve o resultado de quem o tomou.

**`LOCAL` roda dentro da transação que conclui a chave.** O callback recebe
`Prisma.TransactionClient`, e escrita de domínio, allowlist e conclusão são um
commit só. É o que fecha a janela "`GenerationRun` criado, resposta idempotente
não gravada": qualquer falha derruba os três juntos.

**Exceção externa nunca libera.** `LOCAL` pode ser liberada porque a transação
comprovadamente caiu. `EXTERNO_AMBIGUO` que lança vai duravelmente para
`CONCILIACAO`; `EXTERNO_RECONCILIAVEL` que lança permanece, e a decisão seguinte
consulta `reconcile` antes de qualquer execução. Apagar a chave externa porque o
processo caiu transformaria a próxima chamada numa nova tentativa do que talvez
já tenha acontecido.

**Ordem das propriedades do corpo não conta; ordem de lista conta.** `{a, b}` e
`{b, a}` são o mesmo pedido — ordem de objeto JSON não é semântica e varia entre
clientes —, `[1, 2]` e `[2, 1]` não são.

**Testes** (contra o Postgres local)
- duas organizações com a mesma chave não colidem; escopo é obrigatório;
- segunda chamada com o mesmo corpo devolve a resposta gravada sem reexecutar;
- mesma chave com corpo diferente → 409, sempre, inclusive com a primeira viva;
- `EM_ANDAMENTO` **não** vencida responde "em andamento", não duplica;
- **dois e seis takeovers simultâneos executam o trabalho uma vez**;
- **executor antigo terminando depois do takeover não sobrescreve**, e suas
  escritas locais caem junto;
- `EM_ANDAMENTO` vencida com `LOCAL` **é assumida**;
- `EXTERNO_AMBIGUO` vencida → **`CONCILIACAO` persistida**, nunca repetição;
- `EXTERNO_RECONCILIAVEL` vencida consulta antes de decidir, e só executa se o
  provedor disser que nada existe;
- trabalho `LOCAL` que escreve e lança: entidade e conclusão caem juntas;
- resposta `LOCAL` fora da allowlist reverte o trabalho local; resposta externa
  fora da allowlist não libera nem repete;
- `CONCILIACAO` fica persistida e não é assumida por chamada comum;
- relógio do processo adiantado e atrasado não muda o vencimento;
- nenhuma resposta ou erro persiste texto externo.

**Janelas** — morte depois de reservar a chave e antes de gravar a resposta;
dois takeovers no mesmo instante; executor antigo terminando tarde.

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

  Zero linhas significa que não cabe. Na mesma transação vão três escritas, e só
  elas: a reserva, a linha de `CreditLedgerEntry` e o job `credit.threshold` com
  chave `credit:<reservationId>`. `UsageLedger` **não** entra — uso é gravado na
  execução (commit 12).

  O vigia nasce junto de propósito. Enfileirá-lo depois pediria uma segunda
  transação, e é exatamente entre as duas que o processo morre: sobraria uma
  reserva que ninguém vai vencer, renovar nem liberar — dinheiro comprometido sem
  data para voltar.

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
- `credits-threshold-nasce.test.ts` — toda reserva sai da transação com seu
  `credit.threshold` já enfileirado; falha ao enfileirar desfaz a reserva
  inteira; duas reservas concorrentes produzem dois vigias, um por
  `reservationId`; `UsageLedger` **não** é tocado aqui.

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
- `src/lib/credits/threshold.ts` — handler `credit.threshold`, enfileirado pela
  transação da reserva (commit 8) e **reusado** a cada renovação: renovar é
  `deferJob(job, +2 h)` no mesmo job, nunca um job novo. A chave
  `credit:<reservationId>` é única e permanente — um segundo vigia para a mesma
  reserva não caberia no índice.

  Ao vencer as 2 h ele **decide**, e as decisões saem da tabela de desfechos,
  lendo `startDisposition`: reserva já liquidada → encerra sem renovar;
  `INICIADO` com run em execução → renova; `NAO_TENTADO` ou
  `SEM_EFEITO_COMPROVADO` com o job ainda vivo → **renova também**, porque a
  reserva atravessa a retentativa segura; as mesmas disposições com o job já
  terminal → libera; `EM_TENTATIVA` e `AMBIGUO` → bloqueia a conta e manda para
  `CONCILIACAO`.
- `src/lib/credits/reconcile.ts`, `src/app/api/organizations/credits/route.ts`,
  `src/app/organizacao/creditos/page.tsx`, permissão `credit:manage`.

**A tabela de desfechos é o contrato desta seção.** Toda saída termina com a
reserva **liberada, renovada, consumida ou em conciliação**. Não existe caminho
que devolva controle deixando reserva viva sem vigia: o `credit.threshold` nasceu
com ela e só para quando ela é liquidada.

**Testes** — cada linha da tabela de desfechos, uma a uma; **nenhum caminho
libera sem prova de que não houve chamada paga**; renovar reusa o **mesmo** job
(`id` estável, `runAt` adiantado) e não cria um segundo; sucesso em `FALSO` e em
`SANDBOX` consome o preço configurado; real maior sem espaço bloqueia e não fica
negativo; liberar restaura os dois números juntos; conciliar exige
`credit:manage` e é auditado na mesma transação; **negativo:** reserva de A não
é conciliável por ator de B, e reserva não aponta para job de outra organização.

**Janelas** — run mais longo que o limiar; ambiguidade no vencimento; custo real
acima do estimado; limiar vencendo no mesmo instante da liquidação.

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
`.startAttemptedAt`, `.startDisposition`, `.providerIdempotencyKey`, os dois
`CHECK` da disposição, e índice **único** em `SiteRevision.generationRunId`),
`src/lib/generation/start.ts`, `src/lib/generation/poll.ts`,
`src/lib/generation/disposition.ts` (o domínio fechado e a classificação por
tipo de erro).

`start` **carrega** o run pelo `generationRunId` do job; ausência é erro de
programação. Em ordem, decidindo sempre pela disposição:

1. `INICIADO` → não chama nada; segue direto para o handoff;
2. `EM_TENTATIVA` ou `AMBIGUO` → só repete se o provedor declarar
   `idempotentStart`; com `reconcileByKey`, consulta antes; sem nenhuma das
   duas, `CONCILIACAO`;
3. `SEM_EFEITO_COMPROVADO` → **reusa a reserva existente**, pela mesma
   `operationKey`, e segue como se fosse a primeira chamada;
4. `NAO_TENTADO` → provisionamento completo → preço → reserva, `credit.threshold`
   e `startAttemptedAt` na mesma transação;
5. grava `EM_TENTATIVA` **e comita**, antes da chamada;
6. chama o provedor;
7. sucesso → `INICIADO` e `providerRunId`, **enfileirando `generation.poll` na
   mesma transação**; erro interno tipado e seguro →
   `SEM_EFEITO_COMPROVADO` e `failJobRecoverable`, com a reserva intacta;
   qualquer outro erro → `AMBIGUO` e `CONCILIACAO`.

O passo 5 é uma transação própria de propósito. Escrever `EM_TENTATIVA` junto
com a chamada não protegeria de nada: o que precisa estar no banco **antes** do
efeito é justamente a marca de que ele pode ter acontecido.

Esgotar as tentativas ainda em `SEM_EFEITO_COMPROVADO` é a única carta morta que
**libera** a reserva — nesse ponto, e só nesse, está provado que nada foi
chamado.

`poll` observa e persiste. Ao concluir, cria a `SiteRevision` imutável, grava a
linha de `UsageLedger` com `reference = <generationRunId>` **e enfileira
`checks.poll` e `preview.poll` na mesma transação**. Nenhuma transição de projeto
aqui.

Um run produz exatamente **uma** revisão, e quem garante isso é o banco:
`SiteRevision.generationRunId` é único. Sem esse índice, um lease vencido com o
handler anterior ainda vivo cria a segunda revisão — e a partir daí a barreira
compara fatos de revisões diferentes, e ou nunca fecha, ou fecha sobre o
`commitSha` errado.

**Testes**
- sem preço, nada é reservado nem chamado;
- sem crédito, `start` nunca é chamado;
- falha ao gravar o run libera a reserva;
- **janela do lease:** disposição `EM_TENTATIVA` reencontrada, provedor sem as
  duas capacidades → `CONCILIACAO` e `start` **não** é chamado; com
  `idempotentStart` → repete; com `reconcileByKey` → `findRunByKey` e adota;
- **disposição:** `EM_TENTATIVA` é gravado e comitado **antes** da chamada — o
  teste injeta a morte entre os dois e encontra `EM_TENTATIVA` no banco;
  sucesso grava `INICIADO` com `providerRunId`; o `CHECK` recusa `INICIADO` sem
  `providerRunId` e `providerRunId` sem `INICIADO`;
- **falha segura sem efeito → mesma reserva:** erro interno tipado grava
  `SEM_EFEITO_COMPROVADO`, e a retentativa reusa a reserva existente pela
  `operationKey`. A conta não oscila entre as duas tentativas;
- **nenhuma segunda reserva, nenhum segundo vigia:** depois de três
  retentativas seguras existe **uma** `CreditReservation` e **um**
  `credit.threshold`, e o ledger não tem par liberação/reserva no meio;
- **crash em `EM_TENTATIVA` → ambiguidade:** o run reencontrado nessa disposição
  vai a `CONCILIACAO` sem repetição cega, mesmo com a reserva viva;
- **esgotamento em `SEM_EFEITO_COMPROVADO` → libera:** consumidas as tentativas,
  a carta morta libera a reserva, grava o ledger e encerra o `credit.threshold`;
- **erro desconhecido → conciliação:** um erro que a classificação não reconhece
  grava `AMBIGUO`, nunca `SEM_EFEITO_COMPROVADO`, e a reserva vai a conciliação
  com a conta bloqueada;
- **handoff:** falha ao enfileirar `generation.poll` desfaz a gravação do
  `providerRunId`, e a retentativa encontra o run pelo provedor em vez de
  disparar outro;
- **retomada pós-handoff:** com `providerRunId` já gravado, a retentativa não
  chama `start` e enfileira o poll;
- `poll` executando → `deferJob` sem consumir tentativa; concluído cria **uma**
  `SiteRevision` e **dois** jobs irmãos; repetir não cria segunda revisão nem
  jobs duplicados (chaves por etapa); prazo de 2 h estourado → `CONCILIACAO`;
- **lease vencido, concorrente:** dois handlers do mesmo run concluindo ao mesmo
  tempo, em duas transações reais — o índice único derruba o segundo, que relê,
  reconhece a revisão existente e segue para o handoff. Nascem **uma**
  `SiteRevision` e **uma** linha de `UsageLedger`, e os irmãos são enfileirados
  uma vez só.

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

**Quem aplica o que ela decidiu não é puro, e é aí que mora a corrida.** Checks
e preview podem terminar no mesmo instante, em ciclos diferentes do consumidor,
e os dois vão ler três fatos completos. Por isso `applySystemTransition` aplica
uma **atualização condicional**:

```sql
UPDATE "SiteProject"
   SET "status" = $resultado
 WHERE "id" = $projeto
   AND "status" = 'GERANDO'
```

Zero linhas não é erro: significa que o irmão chegou primeiro. Quem atualizou
grava a auditoria **na mesma transação**; quem não atualizou relê o estado,
reconhece que já é terminal e encerra sem escrever nada. Um observador
transiciona, um audita, e a linha de auditoria nunca sai em dobro.

**Falha terminal é terminal.** Quando o resultado é `FALHOU`, a mesma transação
cancela o job irmão ainda vivo, com razão fechada. E como a condição exige
`status = 'GERANDO'`, o irmão que terminasse depois com sucesso não teria como
reverter: encontra `FALHOU`, não encontra `GERANDO`, e não escreve. Não existe
caminho de volta de `FALHOU` para `PREVIA_PRONTA`.

**Testes** — só a orquestração aplica transição de sistema; ator humano continua
recusado; mudança e auditoria na mesma transação. Barreira: três alinhados →
`PREVIA_PRONTA`; **check de outro commit** → não conclui; **preview de outra
revisão** → não conclui; dois de três → não conclui; check falhando → `FALHOU`
com razão fechada; a barreira não escreve.
**Corrida:** dois observadores concluindo em transações concorrentes → **uma**
transição e **uma** linha de auditoria, e o perdedor devolve o estado terminal
sem erro; falha terminal cancela o job irmão vivo; o irmão que termina depois com
sucesso **não** reverte `FALHOU`.

---

### Commit 14 — `feat(observadores)`: checks e preview como fato

**Arquivos** — `src/lib/providers/ports.ts` (`listChecks`), fake e sandbox,
`src/lib/generation/checks.ts` (grava `GenerationCheck`, prazo **30 min**),
`src/lib/generation/preview.ts` (grava `Deployment` ligado à `SiteRevision`,
prazo **30 min**). Cada um chama a barreira ao terminar, na mesma transação do
fato, e aplica o que ela decidir pela atualização condicional do commit 13 — o
cancelamento do irmão viaja nessa mesma transação.

**Testes** — contrato de `listChecks` nos dois modos; pendente → `deferJob` sem
consumir tentativa; falha grava o fato e a barreira decide; ausente além de 30
min → `CONCILIACAO`; o nome vem de `REQUIRED_CHECK`.
**Irmãos:** rodando em qualquer ordem, o último a gravar conclui; **terminando
juntos**, em transações concorrentes, só um transiciona e audita; rodando duas
vezes, não duplicam fato (`@@unique([siteRevisionId, name])`).
**Negativo:** o poll de um projeto nunca lê deployment de outro; deployment de
outra organização é recusado.

---

### Commit 15 — `feat(ui)`, aceleradores e runbook

**Arquivos** — `src/app/projetos/[id]/geracao/page.tsx` (com `pollCount` e
`attempts` **separados** na tela), `src/app/organizacao/fila/page.tsx`,
`src/lib/jobs/accelerators.ts`, `src/lib/jobs/conciliation.ts`,
`docs/runbook-fila.md`.

#### A saída de `CONCILIACAO`

Um job em conciliação **não** é reprocessável, e isso é desenho, não pendência.
`reprocessDeadLetter` exige `CARTA_MORTA` e vai continuar exigindo: carta morta
significa "falhou, tentamos tudo, a causa é conhecida"; conciliação significa
"não sabemos o que aconteceu do outro lado". Repetir a segunda é exatamente a
repetição às cegas que a fase inteira existe para evitar — e um botão genérico
de "tentar de novo" na tela da fila é como ela apareceria.

A saída é uma ação **própria**, que esta fase deixa registrada e o commit 15
implementa:

| Exigência | Por quê |
| --- | --- |
| Decisão **fechada**, uma por caminho: `EFEITO_CONFIRMADO`, `SEM_EFEITO_CONFIRMADO`, `DESCARTAR` | Quem resolve declara **o fato que apurou**, não "tente de novo". Cada decisão leva o job a um estado diferente, e nenhuma delas é "volte para a fila e veremos". |
| Exige `job:run`, e a decisão vai à auditoria **na mesma transação** | Um job saindo de conciliação sem o nome de quem decidiu, ou um nome gravado para uma saída que rolou atrás, são indistinguíveis numa revisão. |
| A reserva de crédito é liquidada **junto**, na mesma decisão | Conciliação de job e conciliação de crédito são o mesmo fato visto de dois lados. Resolver um e esquecer o outro deixa dinheiro comprometido sem dono. |
| Nunca uma repetição genérica | Se a apuração concluir que nada aconteceu do outro lado, o caminho é enfileirar a etapa **de novo, explicitamente**, com a disposição do run coerente com o que foi apurado — não ressuscitar o job antigo com os contadores zerados. |

Chega ali por três caminhos, e a tela precisa distinguir os três: prazo de
espera estourado, efeito remoto ambíguo (`EM_TENTATIVA` ou `AMBIGUO`), e
`leaseRecoveryCount` esgotado — este último é o único em que nada externo
aconteceu, e ainda assim não se resolve repetindo.

**Testes** — o acelerador nunca conclui nem cria job, e um sistema sem ele chega
ao mesmo estado final, só mais devagar; permissões nas duas telas; a tela da
fila **não** oferece reprocessar para job em `CONCILIACAO`; cada decisão fechada
leva ao seu estado e à sua linha de auditoria, e uma decisão sem `job:run` não
escreve nada.

---

### Commit 16 — `feat(habilitacao)`: requisição idempotente e as travas

**Arquivos** — `src/lib/generation/request.ts`,
`src/app/api/projects/[id]/generate/route.ts`, e as duas travas:
`STAGES_PENDING_ORCHESTRATOR` perde `GERANDO` (`PUBLICANDO` permanece);
`PROVIDERS_PENDING_PHASE` perde `cursor` (`MODES_AVAILABLE` continua sem `LIVE`).

`requestGeneration(actor, siteProjectId, idempotencyKey)`, numa transação só,
**nesta ordem**:

1. a rota valida o cabeçalho `Idempotency-Key`: ausente ou fora do formato UUID
   → `400`, antes de qualquer escrita;
2. `withIdempotency` no escopo `generation.request`, chave a do cliente,
   `sideEffect = LOCAL`; a mesma chave com `requestHash` diferente → `409`;
3. cria o `GenerationRun` em `PENDENTE`;
4. transiciona o projeto para `GERANDO` por **atualização condicional**;
5. enfileira `generation.start` com `generationRunId`, chave de etapa e
   `concurrencyKey` de projeto.

A idempotência vem **antes** do run porque é ela que impede o segundo run de
existir. Depois do run seria tarde: a chave sairia de uma linha criada na mesma
transação, e duas transações concorrentes gerariam duas chaves diferentes.

**O estado de partida não é só `BRIEFING_PRONTO`.** A pergunta certa é se existe
transição autorizada para `GERANDO` na máquina de estados da Fase 1 — e existe a
partir de `BRIEFING_PRONTO`, `PREVIA_PRONTA`, `EM_REVISAO`, `PUBLICADO` e
`FALHOU`, todas com permissão `generation:run`. Repetir essa lista aqui seria
manter a máquina de estados em dois lugares, que é como os dois divergem.
`requestGeneration` pergunta a ela:

```ts
const origens = statesWithTransitionTo("GERANDO"); // de SITE_PROJECT_TRANSITIONS

const { count } = await tx.siteProject.updateMany({
  where: {
    id: siteProjectId,
    organizationId: actor.organizationId,
    status: { in: origens },
  },
  data: { status: "GERANDO" },
});
if (count === 0) throw new GenerationRefusal("PROJETO_NAO_ELEGIVEL");
```

O `updateMany` condicionado ao estado **é** a trava. Duas transações
concorrentes leem o mesmo `BRIEFING_PRONTO`, mas só uma o encontra ainda lá na
hora de escrever; a perdedora recebe zero linhas e é recusada pelo estado. O
vencedor não depende da fila, de lock de aplicação nem da ordem em que o
consumidor acorda — e a permissão `generation:run` continua sendo verificada
antes, no ator.

**Testes**
- run, transição e job caem juntos; falha em qualquer um desfaz os três;
- **sem `Idempotency-Key`** → `400`, e nenhuma linha escrita em lugar nenhum;
- **mesma chave, mesmo corpo** → o **mesmo** `GenerationRun`, o mesmo job e a
  mesma resposta; a segunda chamada não escreve nada;
- **mesma chave, corpo diferente** → `409`, e o run da primeira permanece
  intacto;
- **duas chaves diferentes, simultâneas**, em duas transações reais → só **uma**
  vence a atualização condicional e gera; a outra recebe zero linhas e é
  recusada pelo estado, sem job órfão e sem reserva;
- **chave nova, mesmo briefing, depois de um run terminal** → geração nova. É a
  distinção que a revisão 3 não sabia expressar: a intenção é do cliente, não do
  briefing;
- todo estado com transição autorizada para `GERANDO` entra; `RASCUNHO`,
  `APROVADO`, `PUBLICANDO` e o próprio `GERANDO` são recusados pelo estado,
  não pela fila — e o teste deriva as duas listas de `SITE_PROJECT_TRANSITIONS`,
  para quebrar se a máquina de estados mudar;
- `generation-e2e-falso.test.ts` — cadeia inteira com o consumidor em ciclos:
  pedir → reservar → agente → poll → dois irmãos → barreira → `PREVIA_PRONTA`, e
  a reserva **consumida** ao fim, sem `credit.threshold` vivo;
- o mesmo em `SANDBOX`, com a guarda de rede ativa;
- os testes da Fase 3 que fixam a lista de estados pendentes e a recusa do Cursor
  quebram de propósito e são atualizados aqui.

**Aceite** — `LIVE` indisponível; `PUBLICANDO` fechado; cadeia verde em `FALSO` e
`SANDBOX`.

---

## Rollback

### Código

**Um commit que aplicou migration não se desfaz com `git revert`.** O revert
apaga o arquivo da migration, enquanto o `_prisma_migrations` do banco continua
declarando que ela foi aplicada. O próximo `migrate deploy` encontra histórico e
diretório em desacordo e recusa rodar — em todos os ambientes, inclusive nos que
nada tinham a ver com o defeito.

O que se desfaz é o **comportamento**:

| Situação | Como se desfaz |
| --- | --- |
| Commit sem migration | `git revert` normal |
| Commit com migration, defeito no código | reverter o código **preservando o arquivo da migration** (`git revert -n`, depois `git checkout HEAD -- prisma/migrations/`), ou nem isso: desligar por trava |
| Commit com migration, defeito no schema | **migration compensatória nova**, escrita e revisada — nunca edição nem remoção da aplicada |

Reverter só o código é seguro porque as migrations desta fase são aditivas: o
código antigo não lê coluna nem tabela nova, e elas ficam onde estão. É para isso
que a regra de aditividade existe.

As travas vêm antes do revert sempre que resolvem: `NOX_INTEGRATIONS=disabled`,
`crons` fora do `vercel.json`, `MODES_AVAILABLE` e `STAGES_PENDING_ORCHESTRATOR`.
Desfazer o comportamento do 16 é devolver `GERANDO` a
`STAGES_PENDING_ORCHESTRATOR` e `cursor` a `PROVIDERS_PENDING_PHASE` — sem tocar
em migration alguma. Jobs existentes drenam ou vão a carta morta.

### Freios sem deploy

`NOX_INTEGRATIONS=disabled` pausa os jobs dependentes de provedor sem consumir
tentativa — depois do commit 6 é seguro mantê-lo ligado indefinidamente. Remover
`crons` do `vercel.json` para o consumidor. Jobs param, não se perdem.

### Migrations

Nenhuma migration desta fase remove coluna, tabela ou índice. Desfazer é
**migration compensatória nova** — nunca edição de migration aplicada, e nunca
remoção do arquivo dela por revert. É a regra que o `SecretRef` da Fase 3 já
estabeleceu.

Cada compensação é escrita no commit que a origina, guardada em
`prisma/compensations/<nome>.sql`, **não aplicada**, e revisada antes de qualquer
uso. A ordem de queda é a inversa das dependências:

| Migration | Compensação derruba, nesta ordem | Pré-condição |
| --- | --- | --- |
| `fila_durable` | `Job_concurrency_ativo_uniq`, `Job_idempotency_uniq`, FKs, tabela | fila drenada; nenhum job vivo |
| `idempotencia` | índices, FK, tabela | **tabela vazia**, ou linhas exportadas e a suspensão da proteção assumida |
| `idempotencia_posse` | os dois `CHECK`, a coluna `ownerToken` | nenhuma chave `EM_ANDAMENTO` nem em `CONCILIACAO` |
| `creditos` | `CreditLedgerEntry`, `CreditReservation`, `CHECK`, `CreditAccount` | nenhuma reserva `RESERVADA` ou em `CONCILIACAO` |
| `geracao_colunas` | `SiteRevision_generationRunId_uniq`, as quatro colunas de `GenerationRun` | nenhum run em andamento |
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
autenticado e ler o retorno — `POST` move **somente a fila da sua organização**;
a global é do agendador, por `GET` com a credencial do Cron. O retorno traz
`reclaimed` e `claimed`: resgate acontece dentro da própria execução, então uma
fila que parecia parada por lease de consumidor morto anda no primeiro disparo.

**`lease_perdido` no retorno.** O handler decidiu, mas o job já não era dele
quando foi liquidar — resgatado no meio. Não é falha e não conta tentativa; o
job voltou para a fila. Repetido muitas vezes, procurar consumidores lentos ou
lease curto demais.

**Job em `PAUSADO`.** Freio global ou provedor desligado. Nada foi punido:
`attempts` intocado. Religar; o job volta sozinho no ciclo seguinte ao
vencimento dos 5 min.

**Job travado em `EM_EXECUCAO`.** Lease de consumidor morto; a próxima passada
do consumidor reclama, antes de adquirir qualquer coisa. Se não reclamar, o
lease está vivo — alguém está estendendo, procurar `leaseOwner`.

**Job voltando sempre.** Conferir `leaseRecoveryCount`. Três resgates e ele para
de circular: não é a plataforma caindo, é o job derrubando quem o executa.

**`pollCount` alto.** Espera normal. Conferir `pollDeadlineAt` antes de intervir.

**Job em `CONCILIACAO`.** Ambíguo. **Não reprocessar às cegas** — e não há como:
`reprocessDeadLetter` só aceita `CARTA_MORTA`, de propósito. Consultar o
provedor primeiro; havendo `providerIdempotencyKey` e `reconcileByKey`,
`findRunByKey` responde o que existe. Decidir a partir do fato, pela ação
dedicada de resolução (commit 15), que exige uma decisão fechada, audita na
mesma transação e liquida a reserva junto. Até ela existir, a saída é manual e
deliberada, e isso é preferível a um botão de repetir.

Três caminhos chegam aqui, e eles não se resolvem igual: prazo de espera
estourado, efeito remoto ambíguo, e resgates de lease esgotados
(`lastErrorCode = RESGATES_SUCESSIVOS`). Só o terceiro garante que nada
aconteceu do outro lado — e mesmo ele não se resolve repetindo, porque o que
esgotou os resgates foi o job derrubar consumidores.

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
- **Granularidade do Cron na Vercel.** O consumidor a cada 1 minuto depende do
  plano da conta. Sem essa cadência, o backoff de 30 s volta a ser decorativo e
  os prazos de poll precisam ser relidos.
- **Semântica de `FOR UPDATE SKIP LOCKED` no Postgres gerenciado.** Validado no
  local; um pooler em modo transação pode se comportar diferente, e isso precisa
  ser confirmado antes do primeiro consumidor em produção.
