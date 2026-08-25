# Fase 3 — Provisionamento

> **Papel:** plano executável. É isto que se implementa.
> **Autoridade:** [`spec da arquitetura-alvo`](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> **Contexto:** [plano mestre das Fases 3 a 6](2026-08-25-fases-3-a-6-plano-mestre.md).
> **Pré-requisito:** Fase 2 aprovada.

**Objetivo:** dado um `SiteProject` com briefing v2 aprovado, o NOX OS cria o
repositório privado do cliente a partir do template, commita o snapshot e o
manifesto, cria o projeto Vercel ligado a esse repositório, e mostra a preview
que a Vercel produziu — com a reconciliação disparada por uma pessoa.

## Fora de escopo, explicitamente

Nada disto entra nesta fase, mesmo que pareça pequeno:

- Cursor, em qualquer modo.
- Fila durável, jobs, workers, cron.
- Créditos, reservas, tetos, `UsageLedger` novo.
- Aprovação, publicação, promoção a produção.
- Domínio, SSL.
- Rollback.
- Modo `LIVE` de qualquer provedor.
- Webhooks de GitHub ou Vercel.

Se durante a implementação algo parecer exigir um destes, **pare e reporte** em
vez de trazer meio item da Fase 4 para dentro.

## O que fica ligado ao fim da fase

Nada externo. Os provedores ficam em `FALSO` (padrão) ou `SANDBOX`. Nenhum
repositório remoto, nenhum projeto Vercel, nenhuma chamada paga. A fase termina
com o caminho inteiro exercitado contra implementações falsas e fixtures.

---

## Sem fila: como o trabalho acontece

Não há fila nesta fase. Cada operação é **síncrona, disparada por uma pessoa,
idempotente e retomável**:

- `POST /api/projects/[id]/provision/repository`
- `POST /api/projects/[id]/provision/content`
- `POST /api/projects/[id]/provision/hosting`
- `POST /api/projects/[id]/provision/reconcile-preview`

Cada uma confere o que já existe antes de agir e é segura para repetir. O estado
vive em `SiteProvisioning`, então uma etapa interrompida é retomada apertando o
botão de novo — não é preciso desfazer nada.

Isso é deliberado: sem fila durável, o único jeito honesto de operar é passo a
passo com uma pessoa olhando. A automação vem na Fase 4.

---

## Modelo

```prisma
/// O repositório privado de um site. Um por SiteProject.
model Repository {
  id             String      @id @default(cuid())
  organizationId String
  siteProjectId  String      @unique
  provider       String      @default("github")
  owner          String
  name           String
  /// Nulo até a criação remota acontecer (em FALSO, é um id sintético).
  externalId     String?
  url            String?
  defaultBranch  String      @default("main")
  installationId String?
  protectedAt    DateTime?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@unique([provider, owner, name])
  @@index([organizationId])
}

/// O projeto de hospedagem de um site. Um por SiteProject.
model HostingProject {
  id             String   @id @default(cuid())
  organizationId String
  siteProjectId  String   @unique
  provider       String   @default("vercel")
  externalId     String?
  name           String
  url            String?
  linkedAt       DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

/// O andamento do provisionamento, para que cada etapa seja retomável.
model SiteProvisioning {
  id             String   @id @default(cuid())
  siteProjectId  String   @unique
  // PENDENTE | REPOSITORIO_PRONTO | CONTEUDO_PRONTO | HOSPEDAGEM_PRONTA | PREVIA_RECONCILIADA | FALHOU
  status         String   @default("PENDENTE")
  lastStep       String?
  lastError      String?
  /// SHA-256 do snapshot commitado, para saber se precisa commitar de novo.
  contentSha256  String?
  commitSha      String?
  previewUrl     String?
  previewExternalId String?
  previewCheckedAt  DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

`SiteRevision` **não** muda nesta fase. Ela é a unidade de aprovação, e
aprovação é Fase 5.

---

## Portas e provedores

### `GitRepositoryProvider`

```ts
interface GitRepositoryProvider {
  readonly id: string;
  readonly mode: IntegrationMode;
  isConfigured(): boolean;

  // NOX Provisioner
  createFromTemplate(input: {
    owner: string; name: string; templateOwner: string; templateRepo: string;
  }): Promise<RepoRef>;
  protectDefaultBranch(input: { repo: RepoRef; requiredChecks: string[] }): Promise<void>;

  // NOX Reconciler
  getRepository(input: { owner: string; name: string }): Promise<RepoRef | null>;
  commitFiles(input: {
    repo: RepoRef; branch: string; message: string; files: FileChange[];
  }): Promise<CommitRef>;
}
```

As operações do Provisioner e as do Reconciler ficam na mesma interface mas usam
**credenciais diferentes** por baixo — dois Apps, dois ids, duas chaves. Um teste
afirma que uma chamada do Reconciler nunca resolve a credencial do Provisioner.

### `HostingProvider`

```ts
interface HostingProvider {
  readonly id: string;
  readonly mode: IntegrationMode;
  isConfigured(): boolean;

  /** Preflight: a instalação da Vercel enxerga este repositório? */
  canAccessRepository(input: { repo: RepoRef }): Promise<boolean>;
  createProject(input: { name: string; repo: RepoRef }): Promise<ProjectRef>;
  setEnvironmentVariables(input: { project: ProjectRef; vars: EnvVarInput[] }): Promise<void>;
  listDeployments(input: { project: ProjectRef; commitSha?: string }): Promise<DeploymentInfo[]>;
}
```

`promoteToProduction` e `attachDomain` **não** entram na interface agora. Um
método que existe é um método que alguém chama.

---

## Preflights

Cada etapa recusa antes de agir, com mensagem que diz o que fazer:

| Antes de | Confere |
| --- | --- |
| criar repositório | modo ≠ `DESLIGADO`; `SecretRef` do Provisioner resolve; nome livre; não existe `Repository` para o projeto |
| commitar conteúdo | repositório existe; snapshot passa por `validateSnapshotInvariants` + JSON Schema; `contentSha256` difere do já commitado (senão não faz nada) |
| criar projeto Vercel | repositório existe; **`canAccessRepository` é verdadeiro**; `SecretRef` da Vercel resolve; não existe `HostingProject` |
| reconciliar preview | `HostingProject` existe; há `commitSha` gravado |

O preflight do Vercel é o que impede o erro que aparece tarde: criar um projeto
apontando para um repositório que o GitHub App da Vercel ainda não enxerga
produz um projeto que nunca constrói, e a falha surge longe da causa.

---

## Proteção de branch

O check exigido é **`verify`** — o nome do job no `.github/workflows/ci.yml` do
template. Os demais nomes (`typecheck`, `lint`, `build`, `end to end…`) são
**steps dentro desse job** e não existem como checks para a API do GitHub;
exigi-los deixaria a proteção esperando por algo que nunca chega.

Um teste no `nox-site-template` afirma que existe exatamente um job e que ele se
chama `verify`, para que renomeá-lo lá quebre aqui e não em produção.

---

## Segredos

Quatro referências, todas de escopo `PLATAFORMA` nesta fase:

| `purpose` | Para quê |
| --- | --- |
| `github.provisioner.appId` / `github.provisioner.privateKey` | NOX Provisioner |
| `github.reconciler.appId` / `github.reconciler.privateKey` | NOX Reconciler |
| `vercel.token` | API da Vercel |
| `github.sitesOrg` | Organização exclusiva onde os sites são criados |

Valores só em variável de ambiente. `SecretRef` guarda nome da variável,
propósito, escopo e uma impressão digital para detectar rotação — nunca o valor.

---

## Permissões e auditoria

Permissões novas: `integration:manage`, `provisioning:run`, `provisioning:read`.

| Papel | Ganha |
| --- | --- |
| OWNER / ADMIN | `integration:manage`, `provisioning:run`, `provisioning:read` |
| OPERADOR | `provisioning:read` |
| LEITOR | nada |

Auditado com ator e antes/depois: mudança de modo de integração, criação de
repositório, aplicação de ruleset, commit de snapshot, criação de projeto de
hospedagem, e reconciliação de preview. `lastError` é redigido por allowlist
antes de gravar — erro de provedor frequentemente ecoa cabeçalho de autorização.

---

## Telas

- **`/organizacao/integracoes`** — modo por provedor (`DESLIGADO`/`FALSO`/
  `SANDBOX`), estado de cada `SecretRef`, e o aviso de que `LIVE` não é opção
  nesta fase.
- **`/projetos/[id]/provisionamento`** — as quatro etapas em ordem, cada uma com
  seu estado, o botão que só aparece com `provisioning:run`, o último erro
  quando houver, e o link do repositório, do projeto e da preview quando
  existirem.

UI mínima de propósito: o que precisa existir é o caminho, não o painel.

---

## Critérios de aceite

- Com integração `DESLIGADO`, toda etapa recusa com mensagem clara e **nada**
  acontece.
- Em `FALSO`, o caminho inteiro roda ponta a ponta e produz `Repository`,
  `HostingProject` e `SiteProvisioning` coerentes.
- Repetir qualquer etapa não duplica nada: segunda chamada reconhece o que já
  existe e devolve o mesmo resultado.
- Commitar o mesmo snapshot duas vezes não gera segundo commit.
- Criar projeto Vercel é recusado quando o preflight de acesso falha.
- A proteção de branch pede `verify`, e só.
- Credencial do Reconciler nunca é usada em operação administrativa — com teste.
- Nenhum segredo em banco, log ou auditoria — com teste que varre por padrão de
  token.
- A suíte de contrato passa igual em `FALSO` e em `SANDBOX`.
- Nenhum teste faz rede; a guarda reprova se tentar.
- Typecheck, lint, testes e build verdes; árvore limpa.

---

## Sequência de commits

Cada um verde sozinho, nenhum liga integração.

| # | Commit | Entrega |
| --- | --- | --- |
| 1 | `feat(integracoes)` | `IntegrationSetting` + `SecretRef` (com `scope`), `NOX_INTEGRATIONS`, resolvedor `server-only`, permissão `integration:manage`, auditoria. Migration aditiva. |
| 2 | `feat(integracoes)` | Tela `/organizacao/integracoes` e a API de leitura/alteração de modo. `LIVE` recusado nesta fase. |
| 3 | `feat(portas)` | `GitRepositoryProvider` e `HostingProvider`, o registro por modo, a implementação `FALSO`, e a suíte de contrato. Guarda de rede nos testes. |
| 4 | `feat(provisionamento)` | `Repository`, `HostingProject`, `SiteProvisioning` + migration. Serviço de estado, sem provedor ainda. |
| 5 | `feat(provisionamento)` | Etapa 1: criar repositório do template (Provisioner) + ruleset exigindo `verify`. Idempotente. |
| 6 | `feat(provisionamento)` | Etapa 2: commitar snapshot e manifesto (Reconciler). Não recommita conteúdo idêntico. |
| 7 | `feat(provisionamento)` | Etapa 3: preflight de acesso + criar projeto Vercel + variáveis de ambiente. |
| 8 | `feat(provisionamento)` | Etapa 4: reconciliar preview sob demanda. |
| 9 | `feat(ui)` | Tela `/projetos/[id]/provisionamento` com as quatro etapas e `provisioning:read`/`run`. |
| 10 | `feat(sandbox)` | Modo `SANDBOX` com fixtures gravadas e redigidas; a suíte de contrato roda nos dois modos. |
| 11 | `test(template)` | No `nox-site-template`: teste que afirma que o CI tem um job e que ele se chama `verify`. |
| 12 | `docs` | Runbook: criar os dois Apps, escopos, organização exclusiva, rotação, e o que fazer quando uma etapa falha. |

Ao fim do 12, **peço aprovação antes de ligar qualquer coisa** — e o primeiro
`LIVE` seria GitHub em repositório descartável, numa rodada própria.

---

## Decisões pendentes

1. **A organização GitHub exclusiva já existe?** Se não, alguém precisa criá-la
   antes do commit 5 — é ação manual sua, com os dois Apps instalados nela.
2. **Convenção de nome do repositório.** Proposta: `site-<slug-do-cliente>`, com
   o slug já único por organização. Se dois clientes de organizações diferentes
   colidirem, o nome precisa de prefixo da organização.
3. **Convenção de nome do projeto Vercel.** A Vercel tem limites de tamanho e
   caracteres mais apertados que o GitHub; provavelmente o mesmo slug truncado,
   mas isso precisa ser confirmado contra a API antes do commit 7.
