# Runbook — provisionamento de sites

Como operar as quatro etapas do provisionamento, o que preparar antes de ligar
qualquer coisa de verdade, e o que fazer quando uma etapa falha.

> **Estado atual: nada está ligado.** Todo provedor nasce `DESLIGADO`, e `LIVE`
> não é selecionável. O caminho inteiro roda contra `FALSO` (memória) e
> `SANDBOX` (respostas gravadas). Nenhum repositório remoto, projeto de
> hospedagem ou cobrança existe por causa desta fase.

## As quatro etapas

Não há fila. Cada etapa é síncrona, disparada por uma pessoa, idempotente e
retomável. Uma etapa interrompida é retomada apertando o botão de novo; não é
preciso desfazer nada.

| # | Etapa | Endpoint | O que confere antes de agir |
| --- | --- | --- | --- |
| 1 | Criar repositório | `POST /api/projects/[id]/provision/repository` | integração ligada; nome livre no host; não existe `Repository` para o projeto |
| 2 | Publicar conteúdo | `POST /api/projects/[id]/provision/content` | repositório existe; briefing existe; snapshot passa no contrato; `contentSha256` difere do já commitado |
| 3 | Criar hospedagem | `POST /api/projects/[id]/provision/hosting` | repositório existe; **a instalação enxerga o repositório**; não existe `HostingProject` |
| 4 | Reconciliar prévia | `POST /api/projects/[id]/provision/reconcile-preview` | hospedagem existe; há `commitSha` gravado |

O check exigido é `verify`, e o `nox-site-template` tem um teste próprio que falha
se aquele repositório renomear ou dividir o job — o acordo é verificado dos dois
lados, no CI de cada um.

A ordem é **GitHub antes de Vercel**, e não por gosto: o projeto de hospedagem
nasce ligado a um repositório que precisa existir e ser visível antes.

Tela: `/projetos/[id]/provisionamento`. Executar exige `provisioning:run`
(OWNER/ADMIN); acompanhar exige `provisioning:read` (também o OPERADOR).

## Dois GitHub Apps, não um com dois escopos

Criar repositório é a operação mais privilegiada da fábrica. Ela fica isolada em
um App próprio, com **App ID e chave privada diferentes** do App do dia a dia.
Não são duas instalações do mesmo App: são dois Apps.

| App | Permissões | Usa para | Nunca faz |
| --- | --- | --- | --- |
| **NOX Provisioner** | `administration: write`, `contents: read`, `metadata: read` | Criar o repositório a partir do template e aplicar o ruleset | Commitar conteúdo, ler PR, ler check |
| **NOX Reconciler** | `contents: read/write`, `pull_requests: read/write`, `checks: read`, `actions: read`, `metadata: read` | Commitar snapshot e manifesto, ler PR e checks | Qualquer coisa administrativa |

A credencial do Provisioner é usada em uma única operação por site e some do
caminho quente. Um comprometimento do Reconciler — o que roda o tempo todo — não
cria nem apaga repositório. Um teste do contrato afirma que uma operação
cotidiana nunca resolve a credencial do Provisioner.

### Organização exclusiva

Instale os dois Apps em uma **organização do GitHub que só contenha sites de
cliente**, separada de onde vivem `nox-os`, `nox-site-template` e
`nox-site-kit`. Assim o raio de alcance do Provisioner é uma organização sem
nada crítico dentro, e os repositórios centrais ficam fora do alcance de
qualquer App da fábrica.

> **Pendência:** essa organização precisa ser criada por uma pessoa, com os dois
> Apps instalados nela, antes de qualquer execução `LIVE` da etapa 1.

## Variáveis de ambiente

Valores só em ambiente. O banco guarda `SecretRef` — nome da variável,
propósito, escopo e uma impressão digital para detectar rotação — nunca o valor.

| Variável | Para quê |
| --- | --- |
| `NOX_INTEGRATIONS` | `disabled` força todo provedor a desligado, acima do banco |
| `GITHUB_PROVISIONER_APP_ID` / `GITHUB_PROVISIONER_PRIVATE_KEY` | NOX Provisioner |
| `GITHUB_RECONCILER_APP_ID` / `GITHUB_RECONCILER_PRIVATE_KEY` | NOX Reconciler |
| `NOX_SITES_ORG` | Organização exclusiva que recebe os sites |
| `VERCEL_TOKEN` | API da Vercel |
| `NOX_SITE_TEMPLATE_OWNER` / `NOX_SITE_TEMPLATE_REPO` | Onde está o template |
| `NOX_SITE_TEMPLATE_COMMIT` | Commit imutável do template que gerou o site |
| `NOX_SITE_KIT_VERSION` / `NOX_SITE_KIT_SHA256` | Versão do kit registrada no manifesto |

Os nomes de variável ficam em `SecretRef.envVarName`, então trocar de cofre é
mudar a referência, não o código.

### Rotação

1. Gere a credencial nova no provedor.
2. Troque o valor da variável de ambiente e reinicie a aplicação.
3. Abra `/organizacao/integracoes`. A referência aparece como
   **Definido · rotacionado** quando o valor não bate mais com a impressão
   digital registrada.
4. Atualize a impressão digital e `lastRotatedAt` no `SecretRef`.
5. Revogue a credencial antiga no provedor.

A impressão digital é SHA-256 e não reverte ao segredo; ela existe só para que a
tela consiga dizer "isto mudou".

## Quando uma etapa falha

A última falha aparece na tela do projeto, com a etapa em que aconteceu.

O que fica gravado passa por uma **allowlist**: só a mensagem que o próprio NOX
OS construiu. Um erro que ele não reconhece não deixa nada do texto original —
grava mensagem genérica e um **código de correlação**, e o detalhe vai para o log
do servidor ao lado desse código. Erro de provedor frequentemente ecoa a
requisição, e a requisição levava um cabeçalho de autorização; com denylist,
bastaria um formato de token novo para vazar.

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `INTEGRACAO_DESLIGADA` | provedor em `DESLIGADO`, ou `NOX_INTEGRATIONS=disabled` | Ligue em `/organizacao/integracoes`; confira a variável de ambiente |
| `RECURSO_JA_EXISTE` na etapa 1 | o nome `site-<slug>` já existe na organização | Renomeie o cliente ou mova o repositório existente |
| `PREFLIGHT_FALHOU` citando "Autorize o repositório" | a instalação da Vercel não enxerga o repositório novo | Autorize o repositório na instalação do GitHub da Vercel e execute a etapa 3 de novo |
| `PREFLIGHT_FALHOU` citando o contrato | o snapshot viola um invariante | Corrija o briefing; o site nunca é gerado com snapshot inválido |
| Etapa 4 volta "ainda não terminou de construir" | a plataforma ainda está construindo | Reconcilie de novo em instantes; não é falha |
| `PROJETO_NAO_ELEGIVEL` | o projeto não está em Briefing pronto | Conclua o briefing antes de provisionar |
| `BRIEFING_VERSAO_ANTIGA` | o briefing é v1 | Crie uma versão v2 confirmando serviços e contato |
| `BRIEFING_ADULTERADO` | o conteúdo gravado não bate com a impressão digital | Confirme o briefing de novo; algo o alterou fora do NOX OS |
| `ERRO_INESPERADO` com código de correlação | erro que o NOX OS não reconhece | Procure o código no log do servidor; o detalhe não é gravado no banco |

Nenhuma falha exige desfazer nada à mão. Cada etapa grava a intenção antes da
chamada remota, então uma interrupção entre as duas deixa rastro suficiente para
terminar o trabalho no próximo clique: a etapa pergunta ao provedor o que existe,
adota o que já foi criado e completa o que falta. Um repositório só conta como
concluído com `externalId` e `protectedAt`; uma hospedagem, com `externalId` e
`linkedAt`.

A única recusa que exige ação humana é o nome já pertencer a alguém: se o
recurso existe e não há registro de que o NOX OS tenha tentado criá-lo, ele não é
adotado — commitar o site de um cliente no repositório de outra pessoa seria pior
que falhar.

## O que ainda não existe

Deliberadamente fora desta fase: fila durável, workers e cron; créditos e
reservas; aprovação, publicação e promoção a produção; domínio e SSL; rollback;
webhooks; e o Cursor em qualquer modo. A reconciliação é manual justamente
porque a automática precisa de fila durável.

Polling é a fonte de verdade. Webhook, quando existir, será acelerador — nunca a
verdade.

## Antes do primeiro `LIVE`

Nesta ordem, e uma coisa por vez:

1. A organização exclusiva existe, com os dois Apps instalados e escopos
   conferidos.
2. Todas as variáveis acima definidas, com `SecretRef` correspondente.
3. `NOX_SITE_TEMPLATE_COMMIT`, `NOX_SITE_KIT_VERSION` e `NOX_SITE_KIT_SHA256`
   apontando para artefatos reais — os valores de espaço reservado só servem sob
   `FALSO`.
4. Aprovação explícita para ligar, registrada.
5. Primeiro `LIVE` é **GitHub, em repositório descartável**, numa rodada
   própria. Vercel depois, separado.

Ligar `LIVE` exige tirar o modo de `MODES_AVAILABLE` em
`src/lib/integrations/modes.ts` — um lugar só, com um teste que precisa mudar
junto, de propósito.
