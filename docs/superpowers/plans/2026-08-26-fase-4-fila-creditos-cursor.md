# Fase 4 — Fila durável, créditos e Cursor

> **Papel:** plano executável. É isto que se implementa.
> **Autoridade:** [spec da arquitetura-alvo](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> **Contexto:** [plano mestre das Fases 3 a 6](2026-08-25-fases-3-a-6-plano-mestre.md).
> **Pré-requisito:** Fase 3 aprovada e encerrada em `30645e7`.

**Objetivo:** dado um `SiteProject` provisionado — repositório criado, conteúdo
commitado, hospedagem ligada —, o NOX OS enfileira uma geração de forma durável,
reserva crédito antes de qualquer operação paga, orquestra o Cursor Cloud Agent
por polling, acompanha os checks do GitHub e a preview da Vercel, e move o
projeto de `GERANDO` para `PREVIA_PRONTA` ou `FALHOU` com base em fatos
verificados.

## O que fica ligado ao fim da fase

Nada externo. Os provedores continuam em `DESLIGADO` (padrão), `FALSO` ou
`SANDBOX`. Nenhuma chamada paga, nenhum repositório remoto, nenhum projeto
Vercel, nenhum agente Cursor. A fase termina com o caminho inteiro exercitado
contra implementações falsas e fixtures gravadas.

## Fora de escopo, explicitamente

- Aprovação, publicação, promoção a produção, rollback de site — Fase 5.
- Domínio e SSL — Fase 5.
- Modo `LIVE` de qualquer provedor — Fase 6.
- Webhooks e SSE como fonte de verdade. Podem entrar como **aceleradores
  opcionais** (commit 15), e mesmo assim nada depende deles.

Se durante a implementação algo parecer exigir um destes, **pare e reporte** em
vez de trazer meia Fase 5 para dentro.

---

## Decisões arquiteturais que o plano assume

### Não existe worker em processo

O NOX OS roda na Vercel. Uma aplicação serverless não sustenta um laço vivo
consumindo fila — a importação Overpass já aprendeu isso, e o resultado é
`INFINITE_LOOP_DETECTED`. O consumidor é uma **rota que processa um lote
limitado por tempo e retorna**, acionada por Vercel Cron. Nenhum job depende de
o processo continuar vivo; o que garante progresso é o lease e a reconciliação
de lease expirado.

O padrão já existe no repositório: `runOverpassImportBurst(jobId, budgetMs =
235_000)` com `maxDuration = 300` em `src/app/api/import/route.ts`. A fila usa a
mesma forma.

### `FOR UPDATE SKIP LOCKED` é SQL cru

O Prisma 5.22 não expressa isso. A aquisição de jobs usa `$queryRaw` com
`Prisma.sql`, dentro de uma transação. É o único lugar do projeto que precisa de
SQL cru no caminho quente, e por isso ganha teste de integração próprio contra o
PostgreSQL local — a correção depende de semântica do banco, não de TypeScript.

### Polling é a verdade

O job pergunta ao provedor o que aconteceu e grava o que encontrou. Webhook e SSE
podem acelerar a próxima passada, nunca substituí-la. Um job cuja conclusão
dependesse de uma conexão aberta seria um job que trava quando ela cai.

### `GERANDO` continua fechado até o último commit

`STAGES_PENDING_ORCHESTRATOR` em `src/lib/site-factory/states.ts` só perde
`GERANDO` no commit 16, quando a orquestração inteira estiver comprovada.
`PUBLICANDO` continua na lista — é Fase 5.

Isso tem uma consequência prática nos testes dos commits 11 a 14: eles não podem
entrar em `GERANDO` pela transição humana, que segue recusada. Os fixtures
constroem o estado diretamente (`status: "GERANDO"` na linha do projeto) e
exercitam o serviço de orquestração. O caminho de entrada — `requestGeneration`
criando o job na mesma transação da transição — é ligado e testado ponta a ponta
no commit 16. Isso é deliberado: a trava não é enfraquecida para acomodar teste.

### Cursor segue indisponível durante toda a implementação

`PROVIDERS_PENDING_PHASE` em `src/lib/integrations/modes.ts` mantém `cursor` até
o commit 16, e mesmo lá ele passa a aceitar apenas `FALSO` e `SANDBOX`. `LIVE`
continua fora de `MODES_AVAILABLE` — é decisão da Fase 6.

---

## Modelo de dados

Todas as migrations são aditivas e validadas apenas no PostgreSQL local
(`docker compose up -d`, `DATABASE_URL` em `localhost`).

```prisma
/// Outbox transacional. O job nasce na mesma transação da mudança de domínio
/// que o justifica — nunca depois, nunca em outro comando.
model Job {
  id             String   @id @default(cuid())
  organizationId String
  /// generation.run | checks.poll | preview.poll | credit.reconcile
  kind           String
  /// PENDENTE | EM_EXECUCAO | CONCLUIDO | FALHOU | CARTA_MORTA | CONCILIACAO
  status         String   @default("PENDENTE")
  /// Ids e referências. Nunca um segredo — quando precisa de um, carrega o
  /// `purpose` do SecretRef, e o handler resolve no servidor.
  payloadJson    String
  /// Agrupa jobs que não podem correr em paralelo: um por SiteProject.
  dedupeKey      String
  attempts       Int      @default(0)
  maxAttempts    Int      @default(5)
  /// Quando o job volta a ser elegível. Backoff com jitter escreve aqui.
  runAfter       DateTime @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
  /// Só a versão segura, pela mesma allowlist da Fase 3.
  lastError      String?
  lastErrorCode  String?
  correlationId  String?
  siteProjectId  String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  finishedAt     DateTime?

  @@index([status, runAfter])
  @@index([organizationId, kind, status])
  @@index([dedupeKey])
  @@index([leaseExpiresAt])
}

/// Chave de idempotência, escopada por organização.
model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  /// generation.start | credit.reserve | ...
  scope          String
  key            String
  /// SHA-256 do corpo, para detectar chave repetida com corpo diferente.
  requestHash    String
  // EM_ANDAMENTO | CONCLUIDA
  status         String   @default("EM_ANDAMENTO")
  /// Resposta gravada, pela allowlist. Nula enquanto EM_ANDAMENTO.
  responseJson   String?
  /// Um registro EM_ANDAMENTO órfão expira e é assumido pela próxima tentativa.
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, scope, key])
  @@index([status, expiresAt])
}

/// Saldo e teto por organização. Uma linha por organização.
model CreditAccount {
  organizationId       String   @id
  balanceCents         Int      @default(0)
  monthlyCapCents      Int      @default(0)
  /// Zerado pela conciliação mensal, nunca por cálculo derivado em leitura.
  spentThisMonthCents  Int      @default(0)
  periodStartedAt      DateTime @default(now())
  /// Enquanto houver reserva não conciliada, nova geração paga é recusada.
  blockedAt            DateTime?
  blockedReason        String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

/// Uma reserva por operação. A unicidade é por operação, não por estado.
model CreditReservation {
  id              String   @id @default(cuid())
  organizationId  String
  operationKey    String
  amountCents     Int
  // RESERVADA | CONSUMIDA | LIBERADA | EXPIRADA
  status          String   @default("RESERVADA")
  /// Como o valor foi estimado, para a conciliação saber o que comparar.
  estimatedBy     String
  reconciledCents Int?
  reconciledById  String?
  reconciledAt    DateTime?
  expiresAt       DateTime
  jobId           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, operationKey])
  @@index([organizationId, status])
}
```

`GenerationRun` e `SiteRevision` **não mudam de forma**. `GenerationRun` já tem
`provider`, `providerRunId`, `status`, `requestJson`, `resultJson`,
`startedAt`/`finishedAt`. A Fase 4 acrescenta apenas colunas nulas para
branch/PR (commit 11), aditivas.

---

## Sequência de commits

Cada um verde sozinho. Nenhum liga integração. Nenhum cria recurso remoto.

### Commit 1 — `feat(fila)`: modelo, outbox e vocabulário

**Arquivos**
- `prisma/schema.prisma` — `Job`.
- `prisma/migrations/<ts>_fila_durable/migration.sql` — aditiva.
- `src/lib/jobs/kinds.ts` — `JOB_KINDS`, `JOB_STATUSES`, rótulos, type guards.
- `src/lib/jobs/payload.ts` — allowlist de campos do payload por `kind`; recusa
  campo desconhecido em vez de ignorá-lo.
- `src/lib/jobs/outbox.ts` — `enqueueJob(tx, { organizationId, kind, payload, dedupeKey, siteProjectId })`, exigindo `Prisma.TransactionClient`.

**Testes**
- `tests/unit/jobs-payload.test.ts` — allowlist aceita o esperado, recusa campo
  extra, recusa qualquer chave cujo nome sugira segredo, e um teste que tenta
  passar `privateKey`/`token` e falha.
- `tests/unit/jobs-outbox.test.ts` — `enqueueJob` **exige** um cliente
  transacional; chamada com o cliente pooled não compila e, em runtime, lança.
- `tests/unit/jobs-outbox-db.test.ts` — contra o Postgres local: a mudança de
  domínio e o job caem juntos; falha depois de enfileirar desfaz os dois.

**Aceite**
- Nenhum job pode ser criado fora de uma transação.
- Payload com campo fora da allowlist é recusado na escrita, não na leitura.
- `migrate status` limpo; nenhum `DROP`.

**Janelas cobertas** — processo morre entre gravar o domínio e enfileirar o job:
impossível por construção, porque é uma escrita só.

---

### Commit 2 — `feat(fila)`: aquisição com lease

**Arquivos**
- `src/lib/jobs/claim.ts` — `claimJobs({ owner, kinds, limit, leaseMs })` usando
  `$queryRaw` com `FOR UPDATE SKIP LOCKED`, dentro de transação; grava
  `leaseOwner`, `leaseExpiresAt`, incrementa `attempts`, marca `EM_EXECUCAO`.
- `src/lib/jobs/heartbeat.ts` — `extendLease(jobId, owner, ms)`, que só estende
  se o dono ainda for o mesmo.

**Testes**
- `tests/unit/jobs-claim-db.test.ts` — contra o Postgres local:
  - dois consumidores concorrentes não pegam o mesmo job;
  - job com `runAfter` no futuro não é pego;
  - job `EM_EXECUCAO` com lease vivo não é pego;
  - `limit` é respeitado;
  - `dedupeKey` igual não produz dois jobs em execução ao mesmo tempo;
  - `extendLease` de outro dono não altera nada.

**Aceite**
- A concorrência é provada com duas transações reais, não com mock. Este é o
  commit em que um mock provaria a coisa errada.

**Janelas cobertas** — dois crons disparando ao mesmo tempo; consumidor lento
segurando lease enquanto outro tenta pegar.

---

### Commit 3 — `feat(fila)`: conclusão, backoff e carta morta

**Arquivos**
- `src/lib/jobs/complete.ts` — `completeJob`, `failJobRecoverable`,
  `failJobPermanent`, todos aceitando `Prisma.TransactionClient`.
- `src/lib/jobs/backoff.ts` — `nextRunAfter(attempt, { baseMs, capMs, random })`
  com **full jitter**: `random(0, min(cap, base * 2^attempt))`. `random` é
  injetável para o teste ser determinístico.
- Reuso de `describeErrorForStorage` da Fase 3 para `lastError`/`lastErrorCode`.

**Testes**
- `tests/unit/jobs-backoff.test.ts` — cresce, satura no teto, nunca negativo,
  distribui (com `random` controlado), e duas tentativas no mesmo instante não
  produzem o mesmo `runAfter`.
- `tests/unit/jobs-complete.test.ts` — falha recuperável reagenda e mantém
  `PENDENTE`; ao esgotar `maxAttempts` vai para `CARTA_MORTA`; falha definitiva
  vai direto para `CARTA_MORTA` sem consumir tentativas.
- `tests/unit/jobs-error-redaction.test.ts` — cada formato de segredo da Fase 3
  lançado por um handler: nada aparece em `lastError`, e o `correlationId`
  gravado é o mesmo devolvido.

**Aceite**
- Carta morta é visível e reprocessável (commit 4), nunca apagada.
- `lastError` passa pela mesma allowlist da Fase 3 — teste que varre por padrão
  de token.

**Janelas cobertas** — handler lança segredo; job falha na última tentativa.

---

### Commit 4 — `feat(fila)`: reconciliação e reprocessamento

**Arquivos**
- `src/lib/jobs/reconcile.ts` — `reclaimExpiredLeases()` devolve
  `EM_EXECUCAO` com `leaseExpiresAt` no passado para `PENDENTE`, preservando
  `attempts`.
- `src/lib/jobs/dead-letter.ts` — `listDeadLetters(actor)`,
  `reprocessDeadLetter(actor, jobId)` que zera `attempts`, limpa lease e volta a
  `PENDENTE`, com auditoria na mesma transação.
- `src/lib/authz/permissions.ts` — `job:read`, `job:run`.

**Testes**
- `tests/unit/jobs-reconcile-db.test.ts` — lease expirado volta; lease vivo não;
  `attempts` preservado.
- `tests/unit/jobs-dead-letter.test.ts` — reprocessar exige `job:run`; auditoria
  e mudança na mesma transação; falha na auditoria desfaz o reprocessamento.
- Matriz: `OPERADOR` recebe `job:read`, não `job:run`; `LEITOR` nenhum dos dois.

**Aceite**
- Consumidor interrompido não trava trabalho: o próximo ciclo reclama.
- Reprocessar é ato humano, auditado, com ator.

**Janelas cobertas** — consumidor morre com lease na mão; carta morta
reprocessada duas vezes em paralelo.

---

### Commit 5 — `feat(fila)`: consumidor em lote

**Arquivos**
- `src/lib/jobs/consumer.ts` — `runJobBatch({ owner, budgetMs, limit })`: reclama
  leases expirados, pega um lote, executa cada handler dentro do orçamento,
  devolve o que não coube. Registro de handlers por `kind`.
- `src/app/api/jobs/run/route.ts` — `GET` para o Cron, `POST` para disparo
  manual; `maxDuration = 300`; `budgetMs = 235_000`.
- `vercel.json` — entrada `crons` apontando para a rota.
- `src/lib/jobs/cron-auth.ts` — verifica `Authorization: Bearer $CRON_SECRET`
  com comparação de tempo constante; disparo manual exige `job:run`.

**Testes**
- `tests/unit/jobs-consumer.test.ts` — respeita o orçamento e devolve o resto;
  um handler que lança não derruba o lote; um `kind` sem handler vira carta
  morta com código próprio.
- `tests/unit/jobs-run-route.test.ts` — sem `CRON_SECRET` correto, `401`;
  disparo manual sem `job:run`, `403`; `NOX_INTEGRATIONS=disabled` não impede o
  consumidor de rodar, mas todo handler que precisaria de provedor recusa.

**Aceite**
- Nenhum laço permanente. Nenhuma recursão entre funções.
- O consumidor é seguro para rodar em paralelo consigo mesmo.

**Janelas cobertas** — cron dispara enquanto o anterior ainda roda; lote estoura
o orçamento no meio.

---

### Commit 6 — `feat(idempotencia)`: chave escopada e retomada

**Arquivos**
- `prisma/schema.prisma` + migration — `IdempotencyKey`.
- `src/lib/jobs/idempotency.ts` — `withIdempotency({ organizationId, scope, key, requestHash, ttlMs }, work)`.

**Testes**
- `tests/unit/idempotency-db.test.ts` — contra o Postgres local:
  - duas organizações com a mesma chave não colidem;
  - segunda chamada com mesmo corpo devolve a resposta gravada, sem reexecutar;
  - mesma chave com corpo diferente → `409`, sempre;
  - registro `EM_ANDAMENTO` expirado é assumido pela próxima tentativa em vez de
    responder `409` para sempre;
  - registro `EM_ANDAMENTO` **não** expirado responde "em andamento", não
    duplica trabalho.
- Teste da resposta gravada pela allowlist: nada além dos campos declarados.

**Aceite**
- O escopo é `(organizationId, scope, key)`. Um índice sem `organizationId`
  reprova no teste das duas organizações.

**Janelas cobertas** — processo morre depois de reservar a chave e antes de
gravar a resposta.

---

### Commit 7 — `feat(creditos)`: reserva atômica e teto mensal

**Arquivos**
- `prisma/schema.prisma` + migration — `CreditAccount`, `CreditReservation`,
  mais `CHECK` de não-negatividade em `balanceCents` e `spentThisMonthCents`
  (SQL manual, como o `SecretRef` da Fase 3).
- `src/lib/credits/reserve.ts` — `reserveCredits(tx, { organizationId, operationKey, amountCents, estimatedBy, ttlMs })`.
  A reserva é **um único `UPDATE` condicional** —
  `WHERE balanceCents >= $amount AND spentThisMonthCents + $amount <= monthlyCapCents AND blockedAt IS NULL` —
  que devolve zero linhas quando não cabe, na mesma transação que insere a
  reserva e a linha do `UsageLedger`.
- `src/lib/credits/settle.ts` — `consumeReservation`, `releaseReservation`,
  `expireReservations`.

**Testes**
- `tests/unit/credits-db.test.ts` — contra o Postgres local:
  - saldo insuficiente não reserva e não escreve ledger;
  - teto mensal excedido não reserva;
  - conta bloqueada não reserva;
  - duas reservas concorrentes para a mesma `operationKey` produzem uma só;
  - N reservas concorrentes com saldo para N−1 deixam exatamente uma de fora;
  - saldo nunca fica negativo, provado também pelo `CHECK`;
  - retentativa da mesma operação reencontra a reserva em vez de criar outra;
  - liberar devolve o saldo; consumir não;
  - reserva expirada libera o saldo.

**Aceite**
- Saldo, reserva e ledger mudam na mesma transação. Um teste que injeta falha na
  escrita do ledger prova que o saldo não se move.
- Nenhuma operação paga sem reserva anterior — garantido no commit 11.

**Janelas cobertas** — duas gerações simultâneas com saldo para uma; processo
morre entre debitar e registrar.

---

### Commit 8 — `feat(creditos)`: conciliação administrativa

**Arquivos**
- `src/lib/credits/reconcile.ts` — `listPendingReconciliation(actor)`,
  `reconcileReservation(actor, { reservationId, actualCents, note })`.
- `src/app/api/organizations/credits/route.ts` — `GET` com `usage:read`;
  `PATCH` de conciliação com nova permissão `credit:manage`.
- `src/app/organizacao/creditos/page.tsx` — tela mínima: saldo, teto, reservas
  pendentes, bloqueio.
- `src/lib/authz/permissions.ts` — `credit:manage` para OWNER/ADMIN.

**Testes**
- `tests/unit/credits-reconcile.test.ts` — conciliar exige `credit:manage`;
  auditoria e ajuste na mesma transação; conciliar com valor maior que o
  reservado ajusta o saldo e registra a diferença; conciliação pendente além do
  prazo **bloqueia** nova geração paga.
- `tests/unit/credits-route.test.ts` — `OPERADOR` lê e não concilia; `LEITOR`
  não lê.

**Aceite**
- `durationMs` do Cursor **não é preço**. A estimativa é conservadora e a
  conciliação é humana. Um teste afirma que nenhum caminho converte duração em
  centavos automaticamente.
- Falha de conciliação bloqueia, nunca publica em silêncio, nunca autoriza saldo
  negativo.

---

### Commit 9 — `feat(codegen)`: porta v2 e implementação falsa

**Arquivos**
- `src/lib/codegen/provider.ts` — interface v2:
  `start(request): Promise<AgentRunRef>`, `poll(ref): Promise<AgentRunStatus>`,
  `cancel(ref): Promise<void>`, `estimateCost(request): Promise<CostEstimate>`.
  `AgentRunStatus` carrega `state`, `branch`, `pullRequestUrl`, `finishedAt`.
- `src/lib/codegen/fake/fake-agent.ts` — determinística, em memória, com
  progressão controlável por teste.
- `src/lib/codegen/sandbox/` — mappers de payload real, redigidos, mais
  `fixtures/sandbox/cursor/*.json`.
- `src/lib/codegen/registry.ts` — por modo, como os provedores da Fase 3;
  `DESLIGADO` recusa, `LIVE` lança.
- `tests/contract/agent-contract.ts` — suíte única.

**Testes**
- `tests/unit/codegen-falso.test.ts` e `tests/unit/codegen-sandbox.test.ts` —
  a mesma suíte nos dois modos: iniciar devolve ref; poll progride; cancelar é
  idempotente; poll depois de cancelar não volta a EXECUTANDO; branch e PR só
  aparecem quando o run conclui.
- Varredura das fixtures por padrão de segredo, como na Fase 3.
- `getCodeGenerationProvider("cursor")` continua recusando (Cursor pendente).

**Aceite**
- `promoteToProduction` e afins continuam ausentes. Método que existe é método
  que alguém chama.
- A suíte de contrato passa igual em `FALSO` e `SANDBOX`.

---

### Commit 10 — `feat(codegen)`: isolamento por repositório

**Arquivos**
- `src/lib/codegen/isolation.ts` — `buildAgentScope({ repository })` produzindo
  exatamente **um** repositório em `repos`, `workOnCurrentBranch: false`,
  `autoCreatePR: true`, sem MCP server, sem segredo do NOX OS nem da Vercel,
  rede em allowlist.
- Validação na entrada do provider: um request com zero ou dois repositórios é
  recusado antes de qualquer chamada.

**Testes** (obrigatórios, é o coração do commit)
- `tests/unit/codegen-isolation.test.ts`:
  - **negativo:** um agente montado para o cliente A recebe escopo que não
    contém o repositório de B; uma tentativa de montar escopo com os dois é
    recusada;
  - **negativo:** um `AgentRunRef` do cliente A não pode ser consultado nem
    cancelado por um ator da organização de B — recusa igual a inexistente;
  - o escopo nunca carrega `SecretRef` resolvido, só `purpose`;
  - `autoCreatePR` é verdadeiro e `workOnCurrentBranch` é falso, fixados por
    teste — mudá-los quebra aqui.

**Aceite**
- O teste negativo entre organizações é a prova de que o isolamento é do
  domínio, não do provedor.

---

### Commit 11 — `feat(geracao)`: handler do job de geração

**Arquivos**
- `prisma/schema.prisma` + migration aditiva — `GenerationRun.branch`,
  `GenerationRun.pullRequestUrl`, `GenerationRun.reservationId` (todos nulos).
- `src/lib/generation/start.ts` — handler de `generation.run`:
  1. abre contexto (elegibilidade + ordem, reusando a Fase 3);
  2. exige provisionamento completo — repositório, conteúdo e hospedagem;
  3. **reserva crédito** (commit 7) na mesma transação que cria o
     `GenerationRun` em `PENDENTE`;
  4. só então chama `start` do provedor, com idempotência (commit 6);
  5. grava `providerRunId` e reagenda um `generation.poll`.
- `src/lib/generation/poll.ts` — consulta, grava progresso, e ao concluir cria a
  `SiteRevision` imutável com `commitSha`, `branch` e `pullRequestUrl`.

**Testes**
- `tests/unit/generation-start.test.ts` — sem crédito, nada é chamado no
  provedor; sem provisionamento completo, recusa antes do provedor; falha ao
  gravar o `GenerationRun` libera a reserva.
- `tests/unit/generation-poll.test.ts` — timeout ambíguo **não** repete
  automaticamente: o job vai para `CONCILIACAO`; run concluído cria exatamente
  uma `SiteRevision`; repetir o poll não cria uma segunda.
- `tests/unit/generation-audit-rollback.test.ts` — falha na auditoria desfaz a
  conclusão local; a repetição reconcilia e cada evento aparece uma vez.

**Aceite**
- **Nenhuma operação paga sem reserva anterior**, provado por teste que injeta
  falha na reserva e verifica que `start` nunca é chamado.
- Resultado remoto ambíguo para em conciliação, nunca em retentativa cega.

**Janelas cobertas** — morre entre reservar e chamar; entre chamar e gravar
`providerRunId`; entre concluir e gravar a revisão.

---

### Commit 12 — `feat(checks)`: checks do GitHub por polling

**Arquivos**
- `src/lib/providers/ports.ts` — acrescenta
  `listChecks({ repo, ref }): Promise<CheckRun[]>` ao `GitRepositoryProvider`.
- Fake e sandbox implementam; contrato cobre.
- `src/lib/generation/checks.ts` — handler `checks.poll`: o run só conta como
  bem-sucedido quando o check `verify` (constante `REQUIRED_CHECK` da Fase 3)
  concluiu com sucesso no commit da revisão.

**Testes**
- Contrato nos dois modos: checks pendentes, em execução, sucesso, falha,
  ausência de check para o ref.
- `tests/unit/generation-checks.test.ts` — check pendente reagenda com backoff;
  check falhando leva o projeto a `FALHOU` com razão fechada; check ausente
  depois do prazo vai para conciliação, não para sucesso.

**Aceite**
- O nome do check vem de `REQUIRED_CHECK`, não de literal duplicado.

---

### Commit 13 — `feat(preview)`: preview da Vercel por polling

**Arquivos**
- `src/lib/generation/preview.ts` — handler `preview.poll`, reusando
  `listDeployments` e `chooseDeployment` da Fase 3, agora com o commit da
  revisão gerada em vez do commit do snapshot.
- Grava `Deployment` ligado à `SiteRevision`.

**Testes**
- `tests/unit/generation-preview.test.ts` — preview `READY` conclui; `BUILDING`
  reagenda; `ERROR` leva a `FALHOU`; nenhum deployment depois do prazo vai para
  conciliação.
- Isolamento: o poll de um projeto nunca lê deployment de outro.

**Aceite**
- Deployment aponta para `SiteRevision`, mantendo a regra de que toda publicação
  futura aponta para revisão imutável com commit.

---

### Commit 14 — `feat(estados)`: transições de sistema pela orquestração

**Arquivos**
- `src/lib/site-factory/states.ts` — `applySystemTransition(tx, { siteProjectId, from, to, reason })`, o único caminho para as transições com `permission: null`.
- `src/lib/generation/outcome.ts` — sucesso aplica `GERANDO → PREVIA_PRONTA`;
  falha recuperável mantém `GERANDO` e reagenda; falha definitiva aplica
  `GERANDO → FALHOU` com `statusMessage` de razão fechada.

**Testes**
- `tests/unit/system-transition.test.ts` — só a orquestração aplica; um ator
  humano continua recusado; transição inválida recusa; a mudança de estado e a
  auditoria caem na mesma transação.
- `tests/unit/generation-outcome.test.ts` — cada desfecho leva ao estado certo;
  falha recuperável não queima o projeto.

**Aceite**
- `transitionSiteProject` continua recusando `permission: null` para pessoas.
- `GERANDO` ainda está em `STAGES_PENDING_ORCHESTRATOR` — os testes constroem o
  estado, não transicionam para ele.

---

### Commit 15 — `feat(ui)` + aceleradores opcionais

**Arquivos**
- `src/app/projetos/[id]/geracao/page.tsx` — estado do run, tentativas, último
  erro redigido, links de branch/PR/preview.
- `src/app/organizacao/fila/page.tsx` — jobs por estado, cartas mortas,
  reprocessar (`job:run`).
- `src/lib/jobs/accelerators.ts` — ponto único onde um webhook ou SSE, quando
  existir, apenas **antecipa** `runAfter` de um job já enfileirado. Nada
  depende dele.

**Testes**
- `tests/unit/accelerators.test.ts` — o acelerador nunca conclui um job, nunca
  cria um, e um sistema sem ele chega ao mesmo estado final, só mais devagar.
- Permissões nas duas telas.

**Aceite**
- Desligar o acelerador não muda nenhum resultado, só a latência.

---

### Commit 16 — `feat(habilitacao)`: abrir `GERANDO` e o Cursor em modo seguro

**Este é o último commit, e o único que mexe nas travas.**

**Arquivos**
- `src/lib/site-factory/states.ts` — remove `GERANDO` de
  `STAGES_PENDING_ORCHESTRATOR`. `PUBLICANDO` **permanece**.
- `src/lib/integrations/modes.ts` — remove `cursor` de
  `PROVIDERS_PENDING_PHASE`, mantendo `MODES_AVAILABLE` sem `LIVE`.
- `src/lib/generation/request.ts` — `requestGeneration(actor, siteProjectId)`:
  transição para `GERANDO` **e** criação do job na mesma transação (outbox).
- `src/app/api/projects/[id]/generate/route.ts`.

**Testes**
- `tests/unit/generation-request.test.ts` — a transição e o job caem juntos;
  falha ao enfileirar desfaz a transição; pedir duas vezes não cria dois jobs
  (dedupe por `SiteProject`).
- `tests/unit/generation-e2e-falso.test.ts` — caminho inteiro em `FALSO`:
  pedir → job → reserva → agente → poll → checks → preview → `PREVIA_PRONTA`,
  com o consumidor rodando em lotes.
- Atualizar os testes da Fase 3 que fixam a lista de estados pendentes e a
  recusa do Cursor — a mudança tem que quebrá-los, de propósito.

**Aceite**
- `LIVE` continua indisponível para todos os provedores.
- `PUBLICANDO` continua fechado.
- O caminho ponta a ponta passa em `FALSO` e em `SANDBOX`.

---

## Estratégia de rollback

**Por commit.** Cada um é revertível com `git revert` sem tocar no banco, porque
as migrations são aditivas e o código novo nunca é o único a saber ler uma
coluna existente. Reverter o commit 16 fecha `GERANDO` de novo e o Cursor volta a
ser recusado; jobs já enfileirados param de ser criados e os existentes drenam ou
viram carta morta.

**Freio global.** `NOX_INTEGRATIONS=disabled` continua acima do banco. Com ele
ligado, o consumidor roda, mas todo handler que precisaria de provedor recusa —
os jobs voltam para `PENDENTE` com backoff em vez de falhar. É o botão de parada
sem deploy.

**Freio do consumidor.** Remover a entrada `crons` do `vercel.json` para o
consumidor parar sem alterar código. Jobs ficam parados, não se perdem.

**Migrations.** Nenhuma remove coluna ou tabela. Um rollback de código com o
banco à frente continua funcionando: as colunas novas ficam nulas e ninguém as
lê. Se for preciso desfazer uma migration, é uma migration nova que a compensa —
nunca edição de migration aplicada.

**Créditos.** Reverter código não devolve saldo. Reserva pendente de uma versão
revertida expira por `expiresAt` e libera o saldo sozinha; o que já foi consumido
é resolvido pela conciliação administrativa, com ator e registro.

---

## Runbook operacional (esboço; vira `docs/runbook-fila.md` no commit 15)

**Fila parada.** Verificar se o cron está no `vercel.json` e se o
`CRON_SECRET` bate. Disparar manualmente com `POST /api/jobs/run` (exige
`job:run`) e ler o retorno: quantos pegou, quantos concluiu, quantos sobraram.

**Job travado em `EM_EXECUCAO`.** É lease de um consumidor que morreu. A
próxima passada reclama sozinha, passado `leaseExpiresAt`. Se não reclamar, o
lease está sendo estendido por alguém — procurar o `leaseOwner`.

**Carta morta.** Ver em `/organizacao/fila`. Ler `lastErrorCode` e o
`correlationId`; o detalhe está no log do servidor, nunca na linha. Corrigir a
causa e reprocessar — reprocessar zera tentativas e é auditado.

**Job em `CONCILIACAO`.** Resultado remoto ambíguo. **Não reprocessar às
cegas.** Consultar o provedor para descobrir o que existe de fato e decidir. É o
estado que existe justamente para não repetir uma operação paga por causa de um
timeout.

**Conta bloqueada.** Há reserva não conciliada além do prazo. Conciliar em
`/organizacao/creditos` (exige `credit:manage`). Enquanto bloqueada, nenhuma
geração paga começa — por desenho.

**Saldo não bate.** Comparar `UsageLedger` com as reservas. O ledger e o saldo
mudam na mesma transação, então divergência significa escrita fora da aplicação.

---

## Verificação obrigatória a cada commit

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, e
`npx prisma migrate deploy` + `migrate status` **somente** contra o Postgres
local, com o host verificado antes. A guarda de rede
(`tests/setup/no-network.ts`) permanece ativa e auto-verificada. Árvore limpa ao
fim de cada commit.

---

## Decisões em aberto

1. **Cursor em `FALSO`/`SANDBOX` ao fim da fase.** O plano assume que o commit
   16 tira `cursor` de `PROVIDERS_PENDING_PHASE` mantendo `LIVE` fora. Se a
   intenção for manter o Cursor recusado até a Fase 6 inteira, o commit 16 muda:
   só `GERANDO` abre, e a orquestração roda apenas com o provedor falso.
   **Precisa da sua confirmação antes do commit 9.**

2. **Consumidor: Cron da Vercel ou worker dedicado.** O plano escreve para Cron,
   que é o que a conta já suporta. Um worker fora da Vercel muda o commit 5 —
   não o resto. Decidir antes do commit 5.

3. **Estimativa de custo por geração.** `estimateCost` precisa de um número. Sem
   preço verificável por run, a proposta é um valor fixo conservador por
   organização, configurável, com conciliação humana. Precisa do valor.

4. **`maxAttempts` e janela de backoff.** Proposta: 5 tentativas, base 30 s,
   teto 15 min, full jitter. Números fáceis de mudar, mas convém fixá-los antes
   do commit 3.

5. **TTL da reserva de crédito.** Proposta: 2 h, tempo suficiente para um run
   longo do Cursor mais folga. Se um run puder passar disso, o TTL precisa
   crescer ou a reserva precisa ser estendida pelo heartbeat.

6. **Retenção de jobs concluídos.** Nada no plano os apaga. Se a tabela crescer
   demais, entra uma rotina de expurgo — mas isso muda a auditabilidade e
   merece decisão explícita.

---

## Bloqueadores pré-`LIVE`

Herdados da Fase 3, ainda abertos:

- **Validar contra a API real o campo `link` da Vercel e o
  `template_repository` do GitHub no primeiro repositório descartável.** Toda a
  lógica de proveniência depende desses dois campos virem preenchidos como os
  mappers esperam.
- Organização exclusiva do GitHub, com os dois Apps instalados e escopos
  conferidos.
- Convenções de nome de repositório e de projeto Vercel não confirmadas contra
  a API.
- `NOX_SITE_TEMPLATE_COMMIT`, `NOX_SITE_KIT_VERSION` e `NOX_SITE_KIT_SHA256`
  apontando para artefatos reais.
- O SQL manual do `SecretRef` a reler antes de gerar a próxima migration.

Novos desta fase:

- **Conta e credencial do Cursor Cloud Agent**, com `SecretRef` próprio, e
  confirmação de que a API expõe run id, estado, branch e PR — a porta v2 assume
  os quatro.
- **Preço por run verificável.** Enquanto não existir, a conciliação é
  administrativa e a reserva é conservadora; ligar `LIVE` sem isso significa
  gastar sem teto confiável.
- **`CRON_SECRET` definido na Vercel**, e confirmação de que o Cron chama a rota
  com o cabeçalho esperado.
- **Semântica real de `FOR UPDATE SKIP LOCKED` no Postgres gerenciado de
  produção.** O plano valida no Postgres local; um provedor com pooler em modo
  transação pode se comportar diferente, e isso precisa ser confirmado antes do
  primeiro consumidor em produção.
