# Plano mestre — Fases 3 a 6

> **Papel deste documento:** referência arquitetural das Fases 3 a 6. **Não é
> executável.** Cada fase tem (ou terá) um plano próprio, restrito, que é o que
> se implementa.
>
> **Autoridade:** [`docs/superpowers/specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md`](../specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md).
> Onde este documento divergir do spec, o spec vence.
>
> **Plano executável em vigor:** [Fase 3 — Provisionamento](2026-08-25-fase-3-provisionamento.md).
>
> **Status das integrações:** todas desligadas. Nenhum repositório remoto,
> projeto Vercel ou agente Cursor foi criado, e nenhuma chamada paga foi feita.

## Por que existem quatro fases e não uma

A primeira versão deste plano juntava provisionamento, fila durável, créditos,
Cursor, aprovação, publicação e rollback numa Fase 3 só. Isso é grande demais
para revisar de uma vez e grande demais para ligar de uma vez: o momento em que
algo passa a criar repositórios remotos é o momento em que erros deixam de ser
reversíveis num `git reset`.

O roadmap aprovado separa em quatro entregas, cada uma verde e operável
isoladamente:

| Fase | Entrega | O que ela **não** faz |
| --- | --- | --- |
| **3 — Provisionamento** | GitHub App, repositório privado por site, snapshot e manifesto commitados, projeto Vercel ligado, preview reconciliada à mão | Cursor, fila durável, créditos, aprovação, publicação, domínio, rollback, `LIVE` |
| **4 — Orquestração** | Fila durável, créditos, Cursor, polling, PR, checks, previews | Aprovação, publicação, domínio, rollback |
| **5 — Publicação** | Aprovação ligada ao commit, promoção para produção, domínio/SSL, rollback | Endurecimento e `LIVE` amplo |
| **6 — Endurecimento** | Teste de isolamento, falhas, observabilidade, limites, runbooks, `LIVE` gradual | — |

---

## Princípios que atravessam as quatro fases

1. **Nenhum provedor decide estado de negócio.** GitHub, Cursor e Vercel
   reportam fatos. O NOX OS valida o fato e executa a transição.
2. **Nenhuma conexão aberta é fonte de verdade.** SSE e webhooks são
   aceleradores; polling e reconciliação são a verdade.
3. **Toda operação cobrada reserva crédito antes de acontecer.**
4. **Aprovação aponta para uma revisão imutável.** Mudou o commit, caiu a
   aprovação.
5. **Segredo não entra em banco, log, snapshot nem contexto de agente.**
6. **Integração nasce desligada.** `LIVE` é decisão explícita, auditada, de quem
   tem `integration:manage`.

---

# Fase 3 — Provisionamento

Detalhada em [plano próprio](2026-08-25-fase-3-provisionamento.md). O resumo
arquitetural:

## Dois GitHub Apps, não um com dois escopos

Criar repositório é a operação mais privilegiada de toda a fábrica. Ela fica
isolada num App próprio, com **ID e chave privada diferentes** do App do dia a
dia — não são duas instalações do mesmo App, são dois Apps.

| App | Permissões | Usado para | Nunca faz |
| --- | --- | --- | --- |
| **NOX Provisioner** | `administration: write`, `contents: read`, `metadata: read` | Criar o repositório a partir do template e aplicar o ruleset | Commitar conteúdo, ler PR, ler check |
| **NOX Reconciler** | `contents: read/write`, `pull_requests: read/write`, `checks: read`, `actions: read`, `metadata: read` | Commitar snapshot e manifesto, ler PR e checks | Qualquer coisa administrativa |

O credencial do Provisioner é usado em uma única operação por site e some do
caminho quente. Um comprometimento do Reconciler — o que roda o tempo todo — não
cria nem apaga repositório.

**Recomendação: uma organização GitHub exclusiva** para os sites gerados,
separada de onde vivem `nox-os`, `nox-site-template` e `nox-site-kit`. Assim o
raio de alcance do Provisioner é uma organização que só contém sites de cliente,
e os repositórios centrais ficam fora do alcance de qualquer App da fábrica.

## Proteção de branch

O check exigido é **`verify`** — o nome do *job* no
`.github/workflows/ci.yml` do template. `typecheck`, `lint`, `unit tests`,
`build`, `internal links`, `end to end and accessibility`, `end to end with the
minimal snapshot` e `content restored` são **steps dentro dele** e não aparecem
como checks para a API do GitHub. Exigi-los por nome deixaria a proteção
esperando por checks que nunca chegam.

Se um dia for desejável exigi-los separadamente, o caminho é dividir o workflow
em jobs — decisão de CI, não de proteção de branch.

## Preflight do Vercel

Criar o projeto Vercel apontando para um repositório que o GitHub App da Vercel
ainda não enxerga produz um projeto que nunca constrói, e o erro aparece tarde e
em outro lugar. Antes de criar, o provisionamento confirma que a instalação da
Vercel tem acesso ao repositório recém-criado, e falha com mensagem explícita se
não tiver.

## Preview reconciliada à mão

Nesta fase não há fila. Um operador aperta "reconciliar" e o NOX OS consulta a
Vercel naquele instante, grava o que encontrou e mostra. É deliberadamente
manual: a reconciliação automática precisa de fila durável, que é Fase 4.

---

# Fase 4 — Fila durável, créditos e Cursor

## Consumidor em lotes, nunca laço permanente

O NOX OS roda na Vercel. **Não existe "worker em processo"**: uma aplicação
serverless não sustenta um laço que fica vivo consumindo fila, e tentar isso
produz exatamente o `INFINITE_LOOP_DETECTED` que a importação Overpass já
aprendeu a evitar.

O consumidor é um dos dois:

- **Cron da Vercel** chamando uma rota que processa um lote limitado por tempo
  (uma função de até 300 s) e retorna; ou
- **Worker dedicado** fora da Vercel, se o volume justificar.

Nos dois casos o desenho é o mesmo: pegar N jobs, processar dentro de um
orçamento de tempo, devolver o que não coube para a fila. Nenhum job depende de
o processo continuar vivo.

## Fila

`Job` com outbox transacional (o job nasce na mesma transação do estado de
domínio), lease com `FOR UPDATE SKIP LOCKED`, backoff com jitter, e carta morta
visível e reprocessável. Lease expirado volta para `PENDENTE` por reconciliação
— é assim que um consumidor interrompido não trava trabalho.

### Redação no que a fila guarda

`Job.payloadJson`, `Job.lastError` e as respostas guardadas de idempotência
passam por **allowlist de campos**, nunca por denylist. Um payload carrega ids e
referências; se precisar de um valor sensível, carrega a referência ao segredo,
não o segredo. Erros de provedor frequentemente ecoam o cabeçalho de
autorização — por isso `lastError` é redigido antes de gravar, e há teste que
reprova um registro com cara de token.

## Idempotência

Escopo é **`(organizationId, scope, key)`**, não a chave sozinha: duas
organizações podem legitimamente usar a mesma chave, e um escopo global as
colidiria.

Três casos que o desenho precisa cobrir:

1. **Registro `EM_ANDAMENTO` órfão.** Um processo que morreu depois de reservar
   a chave e antes de gravar a resposta deixa a chave travada. Ela tem
   `expiresAt` e um estado recuperável: passado o prazo, a próxima tentativa
   assume o registro em vez de responder `409` para sempre.
2. **Chave repetida com corpo diferente.** `409`, sempre — é quase certo que
   seja bug do chamador.
3. **Timeout ambíguo com provedor sem idempotency key.** Quando não dá para
   saber se a operação aconteceu, o tratamento é **conservador**: não repetir
   automaticamente. O job vai para um estado de conciliação que consulta o
   provedor para descobrir o que existe de fato, e só então decide. Repetir uma
   criação de repositório ou uma execução paga por causa de um timeout é pior
   que esperar por uma pessoa.

## Créditos

```prisma
model CreditReservation {
  id             String   @id @default(cuid())
  organizationId String
  /// A operação que esta reserva cobre. Uma reserva por operação.
  operationKey   String
  amountCents    Int
  // RESERVADA | CONSUMIDA | LIBERADA | EXPIRADA
  status         String   @default("RESERVADA")
  estimatedBy    String
  reconciledCents Int?
  expiresAt      DateTime
  @@unique([organizationId, operationKey])
}
```

A unicidade é por **operação**, não por `(reference, status)` — aquela versão
permitiria uma reserva `RESERVADA` e outra `LIBERADA` para a mesma operação, e
uma segunda tentativa criaria uma segunda reserva. Com `operationKey` único, uma
retentativa reencontra a reserva existente em vez de reservar de novo.

**Saldo, reserva e ledger mudam na mesma transação.** Debitar o saldo num
comando e gravar o ledger noutro abre uma janela em que os dois discordam, e é
justamente nessa janela que um processo morre. A reserva atômica é um único
`UPDATE ... WHERE balanceCents >= $amount AND spentThisMonthCents + $amount <=
monthlyCapCents`, que devolve zero linhas quando não cabe, dentro da mesma
transação que insere a reserva e a linha do `UsageLedger`.

`durationMs` do Cursor **não é preço**. Enquanto a conta não expuser custo por
run verificável, a reserva é conservadora e a conciliação é administrativa.
Falha de conciliação bloqueia novas gerações pagas, nunca publica em silêncio e
nunca permite saldo negativo não autorizado.

## Cursor

`CodeGenerationProvider` v2 com `start`, `poll`, `cancel` e `estimateCost`.
Exatamente um repositório em `repos`, `workOnCurrentBranch: false`,
`autoCreatePR: true`, sem MCP server, sem segredo do NOX OS ou da Vercel, rede
em allowlist. O merge é sempre do fluxo controlado, nunca do agente.

---

# Fase 5 — Aprovação, publicação e rollback

## Aprovação amarrada ao commit

`Approval` guarda `siteRevisionId` e uma impressão digital
(`commitSha` + `contentSha256`) do instante da aprovação. Mudou o commit, a
aprovação é inválida e uma nova revisão precisa ser aprovada.

## Quem pode aprovar

`requireSeparateApprover` é **configuração por organização, desligada por
padrão**. Numa operação de uma pessoa — que é o caso do beta — exigir aprovador
distinto trava o fluxo sem aumentar a segurança de ninguém.

Duas regras que não são configuráveis:

- **Autoaprovação humana é registrada como tal.** A entrada de auditoria diz
  explicitamente que quem pediu foi quem aprovou, para que a revisão de um
  incidente enxergue isso sem ter que cruzar tabelas.
- **Agente e conta técnica nunca aprovam.** A permissão `publish:approve` é
  recusada para qualquer identidade não humana, independentemente de papel.
  Isso é do spec: nenhum agente pode aprovar ou publicar sozinho.

## Publicação e rollback

Produção sempre aponta para `Deployment.siteRevisionId`. Se qualquer etapa
posterior ao último deployment publicado falhar, o domínio continua servindo o
último publicado. Rollback **cria um novo evento** de deployment para uma
revisão que já esteve em produção com sucesso; o histórico não é reescrito.

---

# Fase 6 — Endurecimento e `LIVE` gradual

## Portão de isolamento — bloqueante

Antes de qualquer `LIVE` do Cursor:

1. iniciar agente no repositório A;
2. pedir explicitamente leitura do repositório B;
3. exigir que a tentativa falhe;
4. registrar a evidência.

Sem isso, o modo máximo do Cursor é `SANDBOX`, mesmo com tudo o mais pronto.
Selecionar um repositório na requisição limita o contexto pedido, mas não prova
que a identidade conectada não alcança outros repositórios autorizados.

## O resto da fase

Testes de falha injetada, observabilidade (métricas de fila, idade de carta
morta, taxa de conciliação travada), limites de concorrência por organização,
runbooks operacionais, e ativação `LIVE` um provedor por vez — começando por
GitHub em repositório descartável.

---

## Segredos, em todas as fases

**Nenhum valor de segredo entra no banco.** O que entra é referência, e a
referência distingue de quem é o segredo:

```prisma
model SecretRef {
  id             String   @id @default(cuid())
  /// PLATAFORMA: credencial do NOX OS, uma para toda a instalação.
  /// ORGANIZACAO: credencial de um cliente, escopada a uma organização.
  scope          String
  /// Nulo quando scope = PLATAFORMA.
  organizationId String?
  purpose        String   // github.provisioner.privateKey | vercel.token | cursor.apiKey
  envVarName     String
  /// SHA-256 do valor, só para detectar rotação. Não reverte ao segredo.
  fingerprint    String?
  lastRotatedAt  DateTime?
  @@unique([scope, organizationId, purpose])
}
```

A distinção importa porque as duas têm ciclos de vida diferentes: a chave do
GitHub App é da plataforma e uma rotação afeta todos os clientes; um token que
pertence a um cliente é escopado e some quando o cliente sai. Misturar os dois
num único registro faria uma rotação de plataforma parecer uma alteração de
cliente na auditoria.

Valores vivem em variável de ambiente. `resolveSecret(ref)` é `server-only`, com
`assertServerSide()`, e nunca loga o valor. Um segredo destinado ao projeto
Vercel do cliente passa pela memória do NOX OS e vai direto para a API — não é
persistido em lugar nenhum.

---

## Feature flags, em todas as fases

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

Padrão de tudo: `DESLIGADO`. `NOX_INTEGRATIONS=disabled` no ambiente **força**
`DESLIGADO` para toda a instalação, independentemente do banco. `LIVE` exige
`integration:manage`, gera auditoria, e é recusado se o `SecretRef`
correspondente não resolver.

---

## Mocks e sandboxes, em todas as fases

| Modo | Implementação | Uso |
| --- | --- | --- |
| `DESLIGADO` | recusa com mensagem clara | padrão |
| `FALSO` | em memória, determinística | testes e desenvolvimento |
| `SANDBOX` | grava/reproduz fixtures | contrato contra respostas reais capturadas |
| `LIVE` | HTTP real | só após aprovação, um provedor por vez |

Uma **suíte de contrato única** roda contra `FALSO` sempre, e contra `SANDBOX`
quando explicitamente habilitada — é isso que impede o falso de divergir do
real. Uma **guarda de rede** nos testes reprova qualquer chamada a host fora da
allowlist: um teste que passa chamando a internet não prova nada. Fixtures de
sandbox são gravadas com segredos redigidos, e há teste que reprova uma fixture
contendo algo com cara de token.

---

## Riscos conhecidos

- **A API v1 do Cursor está em beta** e webhooks ainda são futuros. O desenho não
  depende deles; se mudarem, muda o adaptador, não o domínio.
- **Preço por run do Cursor não é observável** hoje. A reserva conservadora
  protege o teto, mas a conciliação exigirá trabalho administrativo.
- **`administration: write`** é a permissão mais perigosa do conjunto. Isolá-la
  num App separado, com credencial própria, usada em uma operação por site,
  reduz a janela — mas criar repositório continua sendo a operação mais
  privilegiada da fábrica.
- **Custo operacional do multi-project** é maior por desenho, e foi aceito
  conscientemente na arquitetura-alvo.
