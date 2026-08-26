# Agendador externo da fila

A conta Vercel Hobby aceita apenas cron diario. A fila duravel precisa acordar a
cada minuto, portanto a producao usa EventBridge Scheduler e uma Lambda pequena
fora de VPC.

O segredo fica em um parametro `SecureString` do Parameter Store. A funcao pode
ler somente esse parametro e chama `https://nox-os-pi.vercel.app/api/jobs/run`
com `Authorization: Bearer <CRON_SECRET>`. O valor nunca faz parte do pacote,
dos logs ou do repositorio.

Recursos de producao:

- parametro `/nox-os/production/cron-secret`;
- funcao `nox-os-production-cron`;
- role `NoxOsProductionCronLambdaRole`;
- agenda `nox-os-production-jobs-every-minute` em `sa-east-1`.

O cron nativo nao deve voltar a `vercel.json` enquanto o projeto estiver no
plano Hobby, pois a Vercel rejeita o deployment antes do build e das migrations.
