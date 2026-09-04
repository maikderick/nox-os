# Agendador externo da fila

A conta Vercel Hobby aceita apenas cron diário, e um bloco `crons` no
`vercel.json` faz a Vercel recusar o deployment antes do build e das migrations.
A fila durável precisa acordar a cada minuto, então a produção usa EventBridge
Scheduler e uma Lambda pequena, fora de VPC.

**O cron nativo não deve voltar ao `vercel.json` enquanto o projeto estiver no
plano Hobby.** Há teste fixando isso (`jobs-run-route.test.ts`).

## Os arquivos

| Arquivo | O que é |
| --- | --- |
| `limits.json` | A **fonte única** dos números. Lida pelo handler, pelos testes dos dois lados e pelos parâmetros do template. |
| `handler.py` | A função. Confere o destino, resolve o segredo, faz `GET` e espera a resposta. |
| `test_handler.py` | Testes sem rede e sem AWS. |
| `template.yaml` | A infraestrutura, declarada e versionada. **Não aplicada por este repositório.** |

Rodar os testes:

```bash
python -m unittest discover -s infra/aws-cron -p "test_*.py"
```

## Os prazos, e por que nessa ordem

```
consumidor para em 235 s
  < teto da função Vercel 300 s
    < timeout do cliente HTTP 310 s
      < timeout da Lambda 330 s
```

Cada `<` é uma decisão:

- **235 < 300** — o consumidor encerra o lote sozinho antes de a plataforma
  matá-lo. Ser morto no meio é sobrevivível, mas custa um resgate de lease num
  job que não fez nada de errado.
- **300 < 310** — o cliente HTTP não desiste antes de a plataforma desistir. Se
  desistisse, todo ciclo ocupado viraria erro na Lambda enquanto o consumidor
  seguia trabalhando normalmente do outro lado.
- **310 < 330** — a Lambda sobrevive ao seu próprio cliente HTTP, com folga para
  ler o SSM e responder.

A versão anterior tinha `timeout=50` contra um orçamento de 235 s: **todo ciclo
ocupado falhava**, e a fila parecia quebrada exatamente quando estava
funcionando.

**Não é fire-and-forget.** A Lambda espera a resposta. Voltar antes não prova
que o consumidor recebeu a requisição nem que terminou — e uma função que sempre
"dá certo" não está medindo nada. O custo é tempo de Lambda ocioso; na prática,
um ciclo com a fila vazia responde em milissegundos, e só ciclos ocupados
esperam.

## Segurança do destino

`CRON_URL` vem do ambiente, e ambiente é coisa que alguém edita. Se apontasse
para outro host, o `Authorization: Bearer` iria junto.

O handler confere esquema, host e caminho contra `limits.json` **antes** de
resolver o segredo — uma URL adulterada não chega nem a causar a leitura do
parâmetro. Porta, usuário, senha, query e fragmento também são recusados: são
destinos diferentes que apenas se parecem com o certo. Há teste para cada caso.

## O segredo

Fica num `SecureString` do Parameter Store, `/nox-os/production/cron-secret`,
criado **fora** deste template — um `SecureString` declarado em CloudFormation
vira texto claro no histórico do stack.

A política IAM aponta para o **ARN exato**, não para um prefixo:
`/nox-os/production/*` deixaria esta função ler qualquer segredo futuro da
instalação, e ela precisa de um.

O cache em memória **vence** em cinco minutos. Sem prazo, uma rotação nunca
chegaria: o valor antigo continuaria sendo enviado até a Lambda ser reciclada, o
que pode levar horas. O relógio é injetável, então o teste mede isso sem esperar.

Nada do segredo entra em log ou mensagem de erro: o corpo de um `HTTPError` é
drenado e descartado, e os erros de rede são relançados com `from None`, porque
a exceção original carrega a URL. Há teste conferindo o traceback formatado, que
é o que a Lambda realmente registra.

## Retentativa: zero, e é decisão

`MaximumRetryAttempts: 0` no Scheduler.

A fila já tem retentativa com backoff full-jitter, lease e carta morta.
Retentar aqui só acrescentaria mais um consumidor — seguro, porque os leases
impedem trabalho duplicado, e inútil, porque o próximo disparo vem em sessenta
segundos de qualquer jeito. O que ela faria de fato é esconder uma queda real
atrás de ruído de retry, e os alarmes dependem de a falha aparecer.

`MaximumEventAgeInSeconds: 60` pelo mesmo motivo: um disparo que não saiu dentro
do seu próprio minuto não tem por que sair depois — o minuto seguinte já vem.

## Concorrência

`ReservedConcurrentExecutions: 6`. Um disparo por minuto e invocações que podem
durar o timeout inteiro dão sobreposição máxima de `ceil(330 / 60) = 6`.
Reservar menos faria o Scheduler ser barrado justamente quando a fila está cheia
— que é quando as invocações demoram.

Consumidores simultâneos são seguros e desejáveis: os leases garantem que cada
job é de um só, e mais consumidores drenam a fila mais rápido.

## Aplicar

Nada aqui aplica nada. Publicar exige, nesta ordem, com a conta correta:

1. criar o `SecureString` (uma vez, fora do template);
2. empacotar `handler.py` + `limits.json` e publicar a função;
3. aplicar o `template.yaml`.

Recursos de produção esperados: parâmetro `/nox-os/production/cron-secret`,
função `nox-os-production-cron`, papéis `NoxOsProductionCronLambdaRole` e
`NoxOsProductionCronSchedulerRole`, fila `nox-os-production-cron-dlq`, agenda
`nox-os-production-jobs-every-minute`, em `sa-east-1`.
