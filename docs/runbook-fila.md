# Runbook — fila durável, créditos e geração

Para quem está de plantão. Cada seção responde uma pergunta que aparece às
três da manhã, e diz **por que** a resposta é essa — porque a metade das
decisões aqui parece errada até você saber o que ela está evitando.

---

## O mapa em cinco jobs

| `kind` | Faz | Persiste | Enfileira, na mesma transação |
| --- | --- | --- | --- |
| `generation.start` | reserva crédito, chama o agente | reserva, `startAttemptedAt`, `providerRunId` | `credit.threshold` e `generation.poll` |
| `generation.poll` | consulta o agente | ao concluir: `SiteRevision` com `commitSha`, `branch`, `pullRequestUrl` | `checks.poll` **e** `preview.poll` |
| `checks.poll` | consulta o check `verify` | `GenerationCheck` | nada; chama a barreira |
| `preview.poll` | consulta o deployment | `Deployment` ligado à `SiteRevision` | nada; chama a barreira |
| `credit.threshold` | vigia o limiar da reserva | renovação, liberação ou bloqueio | nada; `deferJob` em si mesmo |

**A regra do handoff:** o job seguinte é criado na mesma transação que grava o
fato que o justifica. Se a transação falhar, nem o fato nem o job existem, e a
retentativa refaz os dois.

`checks.poll` e `preview.poll` são **irmãos, não sequenciais**. Rodam em
qualquer ordem; quem chegar por último encontra os três fatos e conclui.

---

## Quem acorda o consumidor

Duas portas, e nenhuma abre a outra:

- **`GET /api/jobs/run`** — o agendador, e só ele. Exige
  `Authorization: Bearer <CRON_SECRET>`, serve **todas** as organizações, e não
  olha sessão nenhuma.
- **`POST /api/jobs/run`** — uma pessoa, e só ela. Exige sessão e `job:run`, e
  move **apenas a fila da organização dela**.

A divisão é por verbo, não por "qualquer credencial que apareça". Uma entrada
única que tentasse o segredo e caísse para a sessão responderia 403 quando o
segredo estivesse errado — o que conta a quem está sondando que o segredo era a
parte errada.

Sem `CRON_SECRET` configurado, o agendador **não funciona**. Ver
`infra/aws-cron/README.md` para o lado de fora.

---

## Esperar não é falhar

A distinção mais importante da fila, e a que mais confunde:

| | Conta | Backoff | Caminha para carta morta |
| --- | --- | --- | --- |
| `deferJob` (esperando) | `pollCount` | não | não |
| `failJobRecoverable` (falhou) | `attempts` | sim | sim |
| `pauseJob` (freio ligado) | nada | não | não |

Um agente gerando, um check na fila, uma prévia construindo: nenhum é um
provedor recusando. Contá-los como tentativa levaria uma geração saudável de
duas horas à carta morta pela ofensa de demorar duas horas.

Estourar `pollDeadlineAt` leva a `CONCILIACAO`, nunca a carta morta: uma geração
que perdeu a paciência pode muito bem ter produzido efeito remoto, e carta morta
diria silenciosamente o contrário.

---

## A disposição, e a única pergunta que ela responde

`GenerationRun.startDisposition` responde **"posso chamar de novo?"** — e nada
mais. É gravada **antes** da chamada, e lida do banco por quem vier depois,
porque o processo que leria uma mensagem de erro é justamente o processo que
pode ter morrido.

| Disposição | O que aconteceu | O que a retentativa faz |
| --- | --- | --- |
| `NAO_TENTADO` | nada saiu daqui | chama |
| `EM_TENTATIVA` | gravado antes da chamada; o processo pode ter morrido com ela em voo | trata como ambíguo |
| `SEM_EFEITO_COMPROVADO` | erro interno tipado, anterior à chamada | chama de novo, **com a mesma reserva** |
| `INICIADO` | `providerRunId` gravado | não chama; segue para o poll |
| `AMBIGUO` | erro desconhecido, ou efeito impossível de descartar | `CONCILIACAO` |

A classificação olha o **tipo** do erro, nunca a mensagem. Uma mensagem é a
única parte de um erro que qualquer coisa pode escrever — inclusive um cliente
que embrulhou um timeout numa frase contendo a palavra "inválido" — e "podemos
cobrar por isto de novo" não é decisão para se tomar num casamento de substring.

Dois `CHECK` no banco sustentam isso: o domínio é fechado, e `INICIADO` e
`providerRunId` andam juntos nos dois sentidos.

---

## Onde o dinheiro para

Toda saída termina com a reserva **liberada, renovada, consumida ou em
conciliação**. Não existe caminho que devolva controle deixando reserva viva sem
vigia: o `credit.threshold` nasce na mesma transação que a reserva e só para
quando ela é liquidada.

| Situação | Job | Projeto | Reserva |
| --- | --- | --- | --- |
| Falha antes de `start` (sem preço, sem crédito, preflight) | `PENDENTE` com backoff | `GERANDO` | mantida |
| Tentativas esgotadas em `SEM_EFEITO_COMPROVADO` | `CARTA_MORTA` | `FALHOU` | **liberada** |
| Run em execução, limiar vencido | `PENDENTE` via `deferJob` | `GERANDO` | **renovada** |
| Agente concluiu, checks e prévia verdes | `CONCLUIDO` | `PREVIA_PRONTA` | **consumida** |
| Agente concluiu, check ou prévia falhou | `CONCLUIDO`; o irmão vivo é cancelado | `FALHOU` | **consumida** |
| Prazo de poll estourado | `CONCILIACAO` | `GERANDO` | **conciliação**, conta bloqueada |
| `AMBIGUO`, ou `EM_TENTATIVA` reencontrado | `CONCILIACAO` | `GERANDO` | **conciliação**, conta bloqueada |
| Custo real acima da reserva, sem espaço | `CONCLUIDO` | conforme a barreira | **conciliação**, conta bloqueada |

**Só duas disposições autorizam liberar** — `NAO_TENTADO` e
`SEM_EFEITO_COMPROVADO` — e apenas quando ninguém mais vai tentar. Liberar em
qualquer outra é reembolsar trabalho que pode ter acontecido e sido cobrado.

Sucesso em `FALSO` e em `SANDBOX` consome o preço configurado como qualquer
outro. O modo muda quem responde, não a contabilidade — um caminho que não
cobrasse em modo falso deixaria a conciliação sem nada para comparar no dia em
que o modo virasse.

---

## A barreira, e a corrida que ela perde com segurança

A barreira é **pura**: recebe três fatos e decide. Só conclui quando os três
apontam para a **mesma `SiteRevision` e o mesmo `commitSha`** — um check verde
do commit anterior é um fato completo sobre código que já não existe.

Quem aplica o que ela decidiu **não** é puro, e aí moram duas corridas:

1. **Os dois irmãos lendo ao mesmo tempo.** Cada um grava seu fato na própria
   transação, e em READ COMMITTED nenhum enxerga o do outro antes do commit. Sem
   proteção, os dois leriam **dois** fatos, os dois decidiriam `AGUARDANDO`, e a
   geração nunca fecharia — com todos os fatos presentes e nada mais para rodar.
   Por isso `settleGeneration` faz `SELECT ... FOR UPDATE` no `GenerationRun`
   antes de ler: o segundo espera e lê um mundo que já contém o fato do irmão.

2. **Os dois irmãos escrevendo ao mesmo tempo.** A transição é uma atualização
   condicional (`WHERE status = 'GERANDO'`). Zero linhas não é erro: significa
   que o irmão chegou primeiro. Quem atualizou grava a auditoria na mesma
   transação; quem não atualizou relê e não escreve nada. Um observador
   transiciona, um audita, e a linha de auditoria nunca sai em dobro.

**Falha terminal é terminal.** Quando o resultado é `FALHOU`, a mesma transação
cancela o irmão ainda vivo. E como a condição exige `GERANDO`, o irmão que
terminasse depois com sucesso encontra `FALHOU` e não escreve: não existe
caminho de volta de `FALHOU` para `PREVIA_PRONTA`.

---

## Como pedir uma geração

```
POST /api/projects/:id/generate
Idempotency-Key: <UUID por intenção>
```

- Sem o cabeçalho, ou com algo que não é UUID: **400**, e nada é escrito.
- Mesma chave, mesmo corpo: **200** com o mesmo run e o mesmo job.
- Mesma chave, corpo diferente: **409**.
- Projeto num estado sem transição autorizada para `GERANDO`: **409**.

A chave é **do cliente**, e precisa ser: uma retentativa de rede reusa a chave,
uma intenção nova gera outra. Derivá-la do projeto e do briefing — como uma
revisão anterior do plano fazia — engolia a segunda geração deliberada do mesmo
site como se fosse duplicata.

`GERANDO` **não** é alcançável por mudança de estado. A rota acima é a única
porta, porque só ela cria o run, reserva o crédito e enfileira o trabalho na
mesma transação; um `PATCH` de status deixaria o projeto em `GERANDO` sem nada
que o tirasse de lá.

---

## Diagnóstico

**"A fila não anda."**
1. `NOX_INTEGRATIONS=disabled`? Todo job com provedor pausa com
   `FREIO_GLOBAL`. É freio, não falha: nada gastou tentativa.
2. O provedor está `DESLIGADO` para a organização? `INTEGRACAO_DESLIGADA`.
3. `CRON_SECRET` configurado dos dois lados?
4. Jobs `EM_EXECUCAO` com lease vencido são resgatados no início de cada
   invocação do consumidor — não existe rotina separada para isso.

**"Um projeto está preso em `GERANDO`."**
Olhe o job, nesta ordem: `status`, `lastErrorCode`, `pollCount`, `attempts`.
- `CONCILIACAO` → uma pessoa precisa decidir em `/organizacao/fila`; veja a reserva e a disposição.
- `PENDENTE` com `pollCount` subindo → está esperando, e isso é saudável.
- Nada na fila e a revisão existe → veja se os dois `GenerationCheck` /
  `Deployment` batem com o `commitSha` da revisão.

**"A conta está bloqueada."**
Sempre por uma reserva em `CONCILIACAO`. `CreditAccount.blockedReasonCode` diz
qual das duas: `EFEITO_AMBIGUO_NA_GERACAO` ou `CUSTO_ACIMA_DA_RESERVA`. O
bloqueio é idempotente — `blockedAt` marca quando o problema começou e não anda
para frente a cada nova ocorrência.

Na fila, `EFEITO_CONFIRMADO` adota somente um `generation.start` com o ID externo,
`SEM_EFEITO_CONFIRMADO` libera a reserva e cria um run novo, e `DESCARTAR` encerra
sem afirmar que existe uma revisão utilizável. A decisão, a liquidação e a auditoria
commitam juntas. Checks e previews não aceitam confirmação genérica: precisam de
evidência ligada ao commit.

**"Preciso rodar um job de novo."**
Só carta morta é reprocessável, e reprocessar exige `job:run`. O reset e sua
linha de auditoria commitam juntos.

---

## Modos, e o que ainda está fechado

- `LIVE` é indisponível para **todos** os provedores (`MODES_AVAILABLE`).
- `PUBLICANDO` continua fechado — é a fase seguinte
  (`STAGES_PENDING_ORCHESTRATOR`).
- `FALSO` e `SANDBOX` percorrem a cadeia inteira, e a suíte roda os dois ponta
  a ponta. `SANDBOX` reproduz respostas gravadas pelos mappers reais e **não
  importa cliente HTTP nenhum** — há teste que verifica isso.
- Nenhuma suíte alcança a rede: `tests/setup/no-network.ts` bloqueia `fetch`.
