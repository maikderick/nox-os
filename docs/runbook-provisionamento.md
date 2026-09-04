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

| # | Etapa | Endpoint | O que exige antes de agir |
| --- | --- | --- | --- |
| 1 | Criar repositório | `POST /api/projects/[id]/provision/repository` | integração ligada; projeto elegível; nome livre no host |
| 2 | Publicar conteúdo | `POST /api/projects/[id]/provision/content` | repositório **completo** (`externalId` + `protectedAt`); snapshot passa no contrato |
| 3 | Criar hospedagem | `POST /api/projects/[id]/provision/hosting` | repositório completo; conteúdo publicado (`contentSha256` + `commitSha`); **a instalação enxerga o repositório** |
| 4 | Reconciliar prévia | `POST /api/projects/[id]/provision/reconcile-preview` | hospedagem **completa** (`externalId` + `linkedAt`); conteúdo publicado |

A tela desabilita o que não está pronto, mas a autoridade é a API: cada endpoint
verifica a ordem antes de tocar em qualquer provedor. Um recurso pela metade —
criado e nunca protegido, ligado e nunca registrado — conta como etapa
interrompida, não como concluída.

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

O que fica gravado passa por uma **allowlist**, e a mensagem é **reconstruída** a
partir de uma razão de conjunto fechado mais campos que o próprio NOX OS
produziu. Nada é copiado da exceção: as classes de erro aceitam texto arbitrário,
então pertencer ao nosso código não prova de onde o texto veio.

Um erro que o NOX OS não reconhece não deixa nada do texto original — nem no
banco, nem na resposta, **nem no log**. Fica uma mensagem genérica e um **código
de correlação**; o log recebe esse código, a etapa e uma classificação de
conjunto fechado. Mensagem insegura para uma coluna é insegura para um arquivo de
log, que é enviado, indexado e lido por mais gente que o banco.

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `INTEGRACAO_DESLIGADA` | provedor em `DESLIGADO`, ou `NOX_INTEGRATIONS=disabled` | Ligue em `/organizacao/integracoes`; confira a variável de ambiente |
| `RECURSO_DE_TERCEIRO` | o nome já existe e o NOX OS nunca tentou criá-lo | Renomeie o cliente ou mova o recurso existente |
| `PROVENIENCIA_NAO_COMPROVADA` | houve uma tentativa, mas o recurso encontrado não veio comprovadamente dela | **Pare e confira à mão.** Ver abaixo |
| `HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO` | existe projeto homônimo ligado a outro repo | Confira o projeto na Vercel; nenhuma variável foi aplicada nele |
| `HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO` | a instalação da Vercel não enxerga o repositório novo | Autorize o repositório na instalação do GitHub da Vercel e execute a etapa 3 de novo |
| `SNAPSHOT_INVALIDO` | o snapshot viola um invariante do contrato | Corrija os campos citados no briefing; o site nunca é gerado com snapshot inválido |
| `REPOSITORIO_INCOMPLETO` / `CONTEUDO_NAO_PUBLICADO` / `HOSPEDAGEM_INCOMPLETA` | etapa chamada fora de ordem, ou etapa anterior interrompida | Volte à etapa anterior e execute-a de novo |
| Etapa 4 volta "ainda não terminou de construir" | a plataforma ainda está construindo | Reconcilie de novo em instantes; não é falha |
| `PROJETO_NAO_ELEGIVEL` | o projeto não está em Pronto para gerar | Conclua o briefing antes de provisionar |
| `BRIEFING_VERSAO_ANTIGA` | o briefing é v1 | Crie uma versão v2 confirmando serviços e contato |
| `BRIEFING_ADULTERADO` | o conteúdo gravado não bate com a impressão digital | Confirme o briefing de novo; algo o alterou fora do NOX OS |
| `ERRO_INESPERADO` com código de correlação | erro que o NOX OS não reconhece | Procure o código no log do servidor; o detalhe não é gravado no banco |

Nenhuma falha exige desfazer nada à mão. Cada etapa grava a intenção antes da
chamada remota, então uma interrupção entre as duas deixa rastro suficiente para
terminar o trabalho no próximo clique: a etapa pergunta ao provedor o que existe,
adota o que já foi criado e completa o que falta. Um repositório só conta como
concluído com `externalId` e `protectedAt`; uma hospedagem, com `externalId` e
`linkedAt`.

As duas recusas que exigem uma pessoa são sobre **de quem é o recurso**.

`creationStartedAt` prova que houve uma tentativa, não que a coisa parada lá agora
seja o resultado dela: um terceiro pode tomar o nome entre a consulta e a
criação. Por isso a evidência vem do provedor — um repositório só é adotado se o
GitHub disser que ele saiu do `nox-site-template`, e um projeto de hospedagem só é
adotado se a Vercel disser que ele está ligado ao repositório deste projeto.

Sem essa prova, a etapa para em `PROVENIENCIA_NAO_COMPROVADA` ou
`HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO` e não escreve nada. Confira o recurso
manualmente: se ele for mesmo deste projeto, remova-o e execute a etapa de novo;
se for de outra pessoa, renomeie o cliente. Adotar por engano significa commitar
o site de um cliente no repositório de um estranho, ou aplicar variáveis de
ambiente num site que não é nosso — nenhum dos dois se desfaz sozinho.

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
