# Fase 3 — Orquestração: fila durável, provisionamento e publicação

> **Status:** plano para aprovação. Nada aqui foi executado.
> **Pré-requisito:** Fase 2 aprovada (contrato `schemaVersion: 2`, briefing v2, exportador fechado, proveniência por entrada).
> **Limite desta fase:** nenhum repositório remoto, projeto Vercel, agente Cursor ou chamada paga é criado até aprovação explícita — e, mesmo depois, só com a integração em modo `LIVE`.

## O problema que esta fase resolve

Hoje o NOX OS sabe descrever um site (briefing v2 confirmado) e sabe projetá-lo em um snapshot que o template aceita. O que falta é o caminho entre uma coisa e outra: alguém precisa criar o repositório do cliente, colocar o snapshot lá dentro, pedir ao Cursor que trabalhe naquele repositório, esperar, conferir o que voltou, mostrar uma prévia, e só então — com aprovação humana de uma revisão exata — publicar.

Cada uma dessas etapas é uma chamada de rede que pode falhar, demorar, cobrar, ou responder duas vezes. A Fase 3 é sobre fazer isso **sem depender de nenhuma conexão aberta, sem cobrar duas vezes pela mesma coisa, e sem que qualquer agente publique nada sozinho**.

## Princípios que não se negociam

1. **Nenhum provedor decide estado de negócio.** GitHub, Cursor e Vercel reportam fatos. O NOX OS valida o fato e executa a transição.
2. **Nenhuma conexão aberta é fonte de verdade.** SSE e webhooks são aceleradores; polling e reconciliação são a verdade.
3. **Toda operação cobrada reserva crédito antes de acontecer.**
4. **Aprovação aponta para uma revisão imutável.** Mudou o commit, caiu a aprovação.
5. **Segredo não entra em banco, log, snapshot nem contexto de agente.**
6. **Integração nasce desligada.** Modo `LIVE` é decisão explícita, auditada, de quem tem `integration:manage`.

---

## 1. Fila durável e polling

### Modelo

```prisma
model Job {
  id             String   @id @default(cuid())
  organizationId String
  kind           String   // github.repo.provision | cursor.run.poll | ...
  payloadJson    String
  // PENDENTE | ARRENDADO | CONCLUIDO | FALHOU | CANCELADO | CARTA_MORTA
  status         String   @default("PENDENTE")
  attempts       Int      @default(0)
  maxAttempts    Int      @default(5)
  availableAt    DateTime @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
  lastError      String?
  /// Deduplica a intenção: dois pedidos iguais viram um job.
  dedupeKey      String?  @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, availableAt])
  @@index([organizationId, kind])
}
```

### Outbox transacional

Um job **nunca** é criado por `await fetch()` dentro de um handler. O domínio grava seu estado e o job na **mesma transação**:

```ts
await prisma.$transaction([
  prisma.generationRun.create({ ... }),
  prisma.job.create({ data: { kind: "cursor.run.start", dedupeKey: `run:${runId}:start`, ... } }),
]);
```

Se a transação falha, não sobra job órfão. Se ela passa, o trabalho existe mesmo que o processo morra no instante seguinte.

### Worker com lease

`claimJob()` usa `FOR UPDATE SKIP LOCKED`, então duas instâncias nunca pegam o mesmo job:

```sql
UPDATE "Job" SET status='ARRENDADO', "leaseOwner"=$1, "leaseExpiresAt"=now() + interval '2 minutes',
                 attempts = attempts + 1
WHERE id = (SELECT id FROM "Job"
            WHERE status='PENDENTE' AND "availableAt" <= now()
            ORDER BY "availableAt" ASC
            FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

- **Lease expirado volta para `PENDENTE`** por um reconciliador periódico — é assim que um worker morto não trava trabalho.
- **Backoff com jitter**: `min(30s * 2^attempts, 15min) * (0.5 + random/2)`, para não sincronizar tentativas.
- **`attempts > maxAttempts` → `CARTA_MORTA`**, visível na tela de operação e reprocessável por quem tem `job:retry`.

### Polling do Cursor

`cursor.run.poll` consulta `GET /v1/agents/{agentId}/runs/{runId}` e reagenda a si mesmo com backoff até um estado terminal. O SSE, quando existir, só atualiza a tela — **nunca** grava estado terminal. Webhook, quando a v1 oferecer, entra como um adaptador de eventos que enfileira o mesmo job; o domínio não muda.

### Timeout e cancelamento

Cada `GenerationRun` carrega `deadlineAt`. Passou disso, o job de poll marca `FALHOU` com `errorMessage` explícito e chama `provider.cancel()`. Um cancelamento pedido por pessoa (`generation:run`) faz o mesmo, imediatamente.

---

## 2. Repositório privado por cliente

### Porta

```ts
interface GitRepositoryProvider {
  readonly id: string;
  isConfigured(): boolean;
  createFromTemplate(input: { name: string; private: true; templateRepo: string }): Promise<RepoRef>;
  commitFiles(input: { repo: RepoRef; branch: string; message: string; files: FileChange[] }): Promise<CommitRef>;
  createBranch(input: { repo: RepoRef; from: string; name: string }): Promise<void>;
  openPullRequest(input: { repo: RepoRef; head: string; base: string; title: string; body: string }): Promise<PullRequestRef>;
  listChecks(input: { repo: RepoRef; ref: string }): Promise<CheckRun[]>;
  protectBranch(input: { repo: RepoRef; branch: string; requiredChecks: string[] }): Promise<void>;
}
```

### GitHub App, não token pessoal

Autenticação por **GitHub App** com token de instalação de curta duração, gerado sob demanda e reduzido ao repositório necessário. Permissões mínimas, confirmadas endpoint a endpoint durante a implementação:

| Permissão | Uso |
| --- | --- |
| `metadata: read` | Resolver o repositório |
| `contents: read/write` | Commitar snapshot e manifesto |
| `pull_requests: read/write` | Abrir e ler o PR do Cursor |
| `checks: read` / `actions: read` | Reconciliar os checks obrigatórios |
| `administration` | Só se for indispensável para criar repositório ou ruleset |

O provisionador privilegiado (que cria repositório e ruleset) fica **separado** do reconciliador cotidiano: duas instalações, dois escopos, para que a operação diária não carregue permissão de administração.

### Fluxo

`github.repo.provision` → cria `site-<slug-do-cliente>` privado a partir do `nox-site-template` → grava `Repository` (nome, owner, url, defaultBranch, installationId) → `content.commit` grava `content/site-content.json` + `content/site-manifest.json` na `main`, com o `templateCommit` que a Fase 2 já exige como entrada.

Idempotência: `dedupeKey = repo:${clientId}`, e antes de criar o job confere se o repositório já existe pelo nome — criar duas vezes é o erro mais caro desta fase.

---

## 3. Projeto Vercel por site

### Porta

```ts
interface HostingProvider {
  readonly id: string;
  isConfigured(): boolean;
  createProject(input: { name: string; repo: RepoRef }): Promise<ProjectRef>;
  setEnvironmentVariables(input: { project: ProjectRef; vars: EnvVarInput[] }): Promise<void>;
  listDeployments(input: { project: ProjectRef; commitSha?: string }): Promise<DeploymentInfo[]>;
  promoteToProduction(input: { project: ProjectRef; deploymentId: string }): Promise<DeploymentInfo>;
  attachDomain(input: { project: ProjectRef; hostname: string }): Promise<DomainInfo>;
}
```

Um projeto por site, ligado **somente** àquele repositório. O token da equipe vive apenas no NOX OS; o banco guarda ids externos, URLs e estados, nunca o token.

Variáveis de produção (`SITE_ENV=production`, `CONTACT_PROVIDER`, e depois `CONTACT_FORM_SECRET`) são injetadas pelo NOX OS **depois** da geração, via API. Elas não são commitadas nem passam pelo Cursor.

---

## 4. Branches, pull requests e checks

- `main` protegida: exige pull request e os checks nomeados do CI da Fase 2 — `typecheck`, `lint`, `unit tests`, `build`, `internal links`, `end to end and accessibility`, `end to end with the minimal snapshot`, `content restored`.
- O Cursor trabalha em `cursor/<runId>`, com `workOnCurrentBranch: false` e `autoCreatePR: true`.
- **O merge é sempre do fluxo controlado, nunca do agente.**
- `github.checks.reconcile` traduz os checks em `SiteRevision.checksJson` + `checksConclusion` (`PENDENTE` | `SUCESSO` | `FALHA`).

Uma revisão só pode ser aprovada com `checksConclusion === "SUCESSO"`.

---

## 5. Prévias e aprovação humana

### `SiteRevision` ganha a proveniência completa

Campos novos, todos exigidos pela arquitetura-alvo: `branchName`, `pullRequestUrl`, `templateRepository`, `templateCommitSha`, `siteKitVersion`, `siteKitSha256`, `briefVersionId`, `factsHash`, `contentSha256`, `previewUrl`, `previewDeploymentId`, `checksJson`, `checksConclusion`. `commitSha` passa a ser obrigatório e completo (40 hex).

### Aprovação amarrada ao commit

```prisma
model Approval {
  id             String   @id @default(cuid())
  siteRevisionId String
  approvedById   String
  approvedAt     DateTime @default(now())
  /// commitSha + contentSha256 no instante da aprovação.
  fingerprint    String
  revokedAt      DateTime?
  revokedById    String?
}
```

`assertApprovalValid(revision, approval)` recomputa a impressão digital e recusa se mudou. Aprovar exige `publish:approve`; quem aprova **não pode ser quem pediu a geração** quando a organização ativar `requireSeparateApprover` (padrão: ligado).

---

## 6. Revisões, deployments e rollback

- Produção sempre aponta para `Deployment.siteRevisionId`. Não existe caminho que publique um commit sem revisão.
- `deployment.promote` promove o deployment **daquele commit**; se a Vercel não tiver um deployment pronto para ele, o job espera em vez de promover outro.
- **Rollback cria um novo evento de deployment** para uma revisão que já esteve em produção com sucesso. Nada é reescrito; o histórico é a auditoria.
- Se qualquer etapa depois do último deployment publicado falhar, o domínio continua servindo o último publicado. Estado novo nunca substitui produção por antecipação.

---

## 7. Créditos, custo estimado e teto

```prisma
model CreditAccount {
  organizationId    String   @id
  balanceCents      Int      @default(0)
  monthlyCapCents   Int      @default(0)
  spentThisMonthCents Int    @default(0)
  periodStart       DateTime
  blockedReason     String?
}

model CreditReservation {
  id             String   @id @default(cuid())
  organizationId String
  reference      String   // generationRunId, deploymentId
  amountCents    Int
  // RESERVADA | CONSUMIDA | LIBERADA | EXPIRADA
  status         String   @default("RESERVADA")
  estimatedBy    String
  reconciledCents Int?
  expiresAt      DateTime
  @@unique([reference, status])
}
```

Sequência obrigatória antes de qualquer operação cobrada:

1. estimar custo máximo (`provider.estimateCost`);
2. conferir saldo, teto mensal e limite por geração;
3. **reservar de forma atômica** — um único `UPDATE ... WHERE balanceCents >= $amount AND spentThisMonthCents + $amount <= monthlyCapCents`, que devolve zero linhas quando não cabe;
4. iniciar o provedor com idempotency key;
5. reconciliar o custo real quando disponível;
6. consumir ou liberar a reserva;
7. acrescentar linha no `UsageLedger`.

**`durationMs` do Cursor não é preço.** Enquanto a conta não fornecer custo por run verificável, a reserva é conservadora e a conciliação é administrativa. Falha de conciliação bloqueia novas gerações pagas (`blockedReason`), nunca publica em silêncio e nunca permite saldo negativo não autorizado.

Também obrigatórios: limite de concorrência por organização, timeout, cancelamento, número máximo de tentativas e **circuit breaker por provedor** (N falhas seguidas → provedor em `ABERTO` por um intervalo, com os jobs voltando para `PENDENTE`).

---

## 8. Replay protection e rate limit duráveis

```prisma
model IdempotencyKey {
  key         String   @id
  scope       String   // api:POST /api/projects/x/generate | provider:cursor.start
  requestHash String
  responseJson String?
  status      String   // EM_ANDAMENTO | CONCLUIDO
  expiresAt   DateTime
}

model RateLimitCounter {
  id        String   @id @default(cuid())
  subject   String   // user:<id> | org:<id> | ip:<hash>
  window    String   // 2026-08-25T14
  action    String
  count     Int      @default(0)
  @@unique([subject, window, action])
}
```

- **Entrada:** toda rota que dispara trabalho cobrado exige `Idempotency-Key`. Chave repetida com o mesmo `requestHash` devolve a resposta guardada; com hash diferente, `409`.
- **Saída:** toda chamada a provedor leva idempotency key derivada de `(runId, tentativa lógica)` — reenviar após timeout não cria um segundo agente.
- **Rate limit** por usuário e por organização, no banco, contando por janela. Substitui a proteção em memória da Fase 2 no lado do NOX OS. A proteção do formulário do template continua local e passa a ser complementada pelo segredo provisionado.

---

## 9. Segredos e credenciais

**Nenhum valor de segredo entra no banco.** O que entra é referência:

```prisma
model SecretRef {
  id             String   @id @default(cuid())
  organizationId String
  purpose        String   // github.app.privateKey | vercel.token | cursor.apiKey
  envVarName     String
  /// SHA-256 do valor, só para detectar rotação. Não reverte ao segredo.
  fingerprint    String?
  lastRotatedAt  DateTime?
  @@unique([organizationId, purpose])
}
```

- Valores vivem em variável de ambiente do servidor. `resolveSecret(ref)` é `server-only`, com `assertServerSide()`, e nunca loga o valor.
- Um segredo destinado ao projeto Vercel do cliente passa pela memória do NOX OS e vai direto para a API da Vercel — não é persistido nem em `SecretRef`.
- Redação em log e em `AuditLog`: um allowlist de campos, nunca um denylist.
- **Nada disso chega ao contexto do Cursor.** O agente recebe o repositório do cliente e o manifesto factual, e mais nada.

---

## 10. Idempotência, retries, timeouts e recuperação

| Risco | Defesa |
| --- | --- |
| Job duplicado | `dedupeKey` único |
| Chamada duplicada ao provedor | idempotency key de saída |
| Requisição duplicada do cliente | `IdempotencyKey` de entrada |
| Worker morto no meio | lease com expiração + reconciliador |
| Provedor lento | `deadlineAt` por run + cancelamento |
| Provedor instável | backoff com jitter + circuit breaker |
| Falha permanente | `CARTA_MORTA` visível e reprocessável |
| Estado externo divergente | reconciliação periódica compara NOX × GitHub × Vercel |

Estado terminal local só é gravado **depois** de persistir o resultado externo.

---

## 11. Auditoria e permissões

Permissões novas: `integration:manage`, `credit:read`, `credit:manage`, `job:read`, `job:retry`, `deployment:rollback`.

| Papel | Ganha |
| --- | --- |
| OWNER / ADMIN | todas as novas |
| OPERADOR | `credit:read`, `job:read` |
| LEITOR | nada |

Auditado com ator, alvo e antes/depois: mudança de modo de integração, ajuste de crédito e de teto, aprovação e revogação, publicação, rollback, criação/rotação de `SecretRef`, reprocessamento de carta morta, e cancelamento de run.

---

## 12. Feature flags

```prisma
model IntegrationSetting {
  organizationId String
  provider       String   // github | vercel | cursor
  // DESLIGADO | FALSO | SANDBOX | LIVE
  mode           String   @default("DESLIGADO")
  enabledById    String?
  enabledAt      DateTime?
  @@id([organizationId, provider])
}
```

- Padrão de tudo: `DESLIGADO`.
- `NOX_INTEGRATIONS=disabled` no ambiente **força** `DESLIGADO` para toda a instalação, independentemente do banco — é o freio de mão.
- `LIVE` exige `integration:manage`, gera entrada de auditoria, e é recusado se o `SecretRef` correspondente não resolver.
- **`LIVE` do Cursor fica bloqueado até o teste de isolamento passar** (item 15).

---

## 13. Mocks e sandboxes

Três implementações por porta, escolhidas pelo modo:

| Modo | Implementação | Uso |
| --- | --- | --- |
| `DESLIGADO` | recusa com mensagem clara | padrão |
| `FALSO` | em memória, determinística | testes e desenvolvimento |
| `SANDBOX` | grava/reproduz fixtures | contrato contra respostas reais capturadas |
| `LIVE` | HTTP real | só após aprovação |

- **Suíte de contrato única** roda contra `FALSO` sempre, e contra `SANDBOX` quando explicitamente habilitada. Mesmos testes, implementações diferentes — é isso que impede o falso de divergir do real.
- **Guarda de rede nos testes:** um `beforeEach` global falha se `fetch` for chamado para host fora da allowlist. Um teste que "passa" chamando a internet não prova nada.
- Fixtures de sandbox são gravadas com segredos redigidos, e há teste que reprova uma fixture contendo algo com cara de token.

---

## 14. Migrations, APIs e telas

### Migrations (aditivas, com backfill)

1. `Job`, `IdempotencyKey`, `RateLimitCounter`
2. `IntegrationSetting`, `SecretRef`
3. `CreditAccount`, `CreditReservation`
4. `Repository`, e os campos novos de `SiteRevision`
5. `Approval`, e `Deployment.rollbackOfDeploymentId`

Nenhuma coluna existente é removida ou renomeada nesta fase.

### APIs

| Rota | Permissão |
| --- | --- |
| `POST /api/projects/[id]/generate` | `generation:run` + `Idempotency-Key` |
| `GET /api/projects/[id]/runs` | `project:read` |
| `POST /api/runs/[id]/cancel` | `generation:run` |
| `GET /api/revisions/[id]` | `revision:read` |
| `POST /api/revisions/[id]/approve` / `revoke` | `publish:approve` |
| `POST /api/revisions/[id]/publish` | `publish:approve` |
| `POST /api/deployments/[id]/rollback` | `deployment:rollback` |
| `GET/PATCH /api/organizations/integrations` | `integration:manage` |
| `GET /api/organizations/credits`, `POST .../adjust` | `credit:read` / `credit:manage` |
| `GET /api/jobs`, `POST /api/jobs/[id]/retry` | `job:read` / `job:retry` |

### Telas

- `/projetos/[id]` — linha do tempo de runs, revisões e deployments; ações de gerar, aprovar, publicar e reverter, cada uma escondida sem a permissão.
- `/projetos/[id]/revisoes/[revisaoId]` — commit, PR, checks, prévia, e o que exatamente será publicado.
- `/organizacao/integracoes` — modo por provedor, com o estado do segredo e o aviso do teste de isolamento pendente.
- `/organizacao/creditos` — saldo, teto, reservas abertas e `UsageLedger`.
- `/operacao/fila` — jobs por estado, cartas mortas com o último erro, e reprocessamento.

---

## 15. Portão de isolamento antes de qualquer `LIVE` do Cursor

Da arquitetura-alvo, e é bloqueante:

1. iniciar agente no repositório A;
2. pedir explicitamente leitura do repositório B;
3. exigir que a tentativa falhe;
4. registrar a evidência.

Se não passar, `LIVE` do Cursor não é liberado até haver identidade/instalação isolada por cliente, controle empresarial equivalente, ou worker self-hosted com credencial limitada a um repositório. Até lá, o modo máximo do Cursor é `SANDBOX`.

---

## 16. Critérios de aceite

- Nenhuma chamada externa acontece com integração fora de `LIVE`; `NOX_INTEGRATIONS=disabled` anula tudo.
- Toda operação cobrada tem reserva atômica antes, e conciliação depois.
- Dois pedidos com a mesma `Idempotency-Key` produzem um único run.
- Worker morto no meio de um job não trava a fila; o lease expira e o job volta.
- `maxAttempts` esgotado vira carta morta visível, com o erro, e reprocessável.
- Aprovação aponta para `SiteRevision.id`; commit diferente invalida a aprovação.
- Produção sempre aponta para um `Deployment` com `siteRevisionId`; rollback cria evento novo.
- Nenhum segredo aparece em banco, log ou auditoria — com teste que varre por padrão de token.
- Suíte de contrato passa igual em `FALSO` e em `SANDBOX`.
- Nenhum teste faz rede; a guarda reprova se tentar.
- Typecheck, lint, testes e build verdes nos três repositórios; árvores limpas.

---

## 17. Sequência de implementação

Cada commit é verde sozinho e não liga integração nenhuma.

| # | Commit | Entrega |
| --- | --- | --- |
| 1 | `feat(fila)` | `Job` + migration + `claimJob` com `SKIP LOCKED`, backoff, lease, carta morta. Testes com banco local. |
| 2 | `feat(fila)` | Worker em processo, reconciliador de lease, `/operacao/fila` e `job:read`/`job:retry`. |
| 3 | `feat(idempotencia)` | `IdempotencyKey` + `RateLimitCounter` duráveis, middleware de rota, testes de replay. |
| 4 | `feat(integracoes)` | `IntegrationSetting`, `SecretRef`, `NOX_INTEGRATIONS`, resolvedor `server-only`, tela e auditoria. |
| 5 | `feat(portas)` | `GitRepositoryProvider` e `HostingProvider` com implementação `FALSO` e a suíte de contrato. Guarda de rede nos testes. |
| 6 | `feat(codegen)` | `CodeGenerationProvider` v2 (`start`/`poll`/`cancel`/`estimateCost`), provedor `FALSO`, `manual` preservado. |
| 7 | `feat(creditos)` | `CreditAccount`, `CreditReservation`, reserva atômica, teto, circuit breaker, `UsageLedger`, tela. |
| 8 | `feat(revisao)` | Campos de proveniência em `SiteRevision`, `Approval` com impressão digital, invalidação por commit. |
| 9 | `feat(provisionamento)` | Jobs `github.repo.provision` e `content.commit` contra o provedor `FALSO`, ponta a ponta. |
| 10 | `feat(hospedagem)` | Job `vercel.project.provision` + injeção de variáveis, contra o `FALSO`. |
| 11 | `feat(geracao)` | Ciclo `cursor.run.start` → `poll` → PR → `checks.reconcile` → `PREVIA_PRONTA`, tudo em `FALSO`. |
| 12 | `feat(publicacao)` | Aprovação, `deployment.promote`, domínio, e `deployment.rollback` como evento novo. |
| 13 | `feat(sandbox)` | Modo `SANDBOX` com fixtures gravadas e redigidas; a suíte de contrato roda nos dois modos. |
| 14 | `test(isolamento)` | Roteiro e registro do teste negativo do Cursor. Sem ele, `LIVE` continua bloqueado. |
| 15 | `docs` | Runbook de operação: carta morta, conciliação travada, rollback, rotação de segredo. |

**Só depois do 15, e com sua aprovação explícita, alguma integração vai para `LIVE`** — e ainda assim uma de cada vez, começando por GitHub em repositório descartável.

---

## Riscos conhecidos

- **A API v1 do Cursor está em beta** e webhooks ainda são futuros. O desenho não depende deles; se mudarem, muda o adaptador, não o domínio.
- **Preço por run do Cursor não é observável** hoje. A reserva conservadora protege o teto, mas a conciliação exigirá trabalho administrativo até a conta expor custo.
- **`administration` no GitHub App** é a permissão mais perigosa do conjunto. Separar o provisionador do reconciliador reduz a janela, mas criar repositório continua sendo a operação mais privilegiada da fase.
- **Custo operacional do multi-project** é maior por desenho, e foi aceito conscientemente na arquitetura-alvo.
