# Fase 1 — Fundamentos da fábrica de sites

**Objetivo:** transformar o NOX OS de gerador de landing pages em orquestrador de uma fábrica SaaS de sites completos, entregando organizações reais, o modelo de domínio do projeto de site, o briefing versionado, a máquina de estados, a interface de provedores de geração de código e a correção das permissões.

**Arquitetura:** o NOX OS passa a ser a fonte de verdade multi-organização. Toda leitura e escrita do novo domínio passa por uma camada de acesso a dados (DAL) em `src/lib/authz` e `src/lib/site-factory`, que resolve a organização do usuário, aplica a matriz de permissões e só então toca o Prisma. Nenhum agente externo é chamado nesta fase: a geração de código é representada por uma interface `CodeGenerationProvider` com um provedor `manual` registrado, para que o Cursor entre depois sem alterar o domínio.

**Stack:** Next.js 16.3.2 (App Router, `proxy.ts`, `params` assíncrono), TypeScript, Prisma 5 + PostgreSQL, NextAuth 4 (JWT), Zod, Tailwind v4, Vitest.

## Restrições globais

- Nenhum dado existente é apagado. Todas as migrations são aditivas e fazem backfill.
- Nenhum segredo entra em código ou banco. Credenciais de provedor só em variáveis de ambiente, lidas dentro da implementação do provedor.
- O Cursor não é integrado nesta fase.
- Rascunho nunca é público. Nem o `SiteProject` em rascunho, nem a `DemoLanding` em `DRAFT`.
- `DemoLanding` fica só como compatibilidade: as existentes continuam funcionando, novas não são criadas.
- Toda publicação futura aponta para um `SiteRevision` imutável, que carrega o commit.
- Produção não é alterada. Migrations e testes rodam contra o Postgres local do `docker-compose.yml`.

## Vocabulário (português, como o resto do domínio)

Estados de `SiteProject`: `RASCUNHO`, `BRIEFING_PRONTO`, `GERANDO`, `PREVIA_PRONTA`, `EM_REVISAO`, `APROVADO`, `PUBLICANDO`, `PUBLICADO`, `FALHOU`.

Papéis de organização: `OWNER`, `ADMIN`, `OPERADOR`, `LEITOR`.

## Estrutura de arquivos

**Domínio e permissões**
- `src/lib/authz/permissions.ts` — lista de permissões e matriz papel → permissões.
- `src/lib/authz/errors.ts` — `AuthorizationError` com `status` 401/403.
- `src/lib/authz/dal.ts` — `server-only`. `requireSession`, `requireMembership`, `requirePermission`, `resolveActiveOrganization`.
- `src/lib/authz/route.ts` — `withAuthorization` para route handlers.
- `src/lib/organizations/bootstrap.ts` — `ensureDefaultOrganization`.

**Fábrica de sites**
- `src/lib/site-factory/states.ts` — estados + máquina de transições.
- `src/lib/site-factory/brief-schema.ts` — schema Zod do briefing, só fatos confirmados.
- `src/lib/site-factory/brief-service.ts` — criação de versão imutável de briefing.
- `src/lib/site-factory/client-service.ts` — `convertBusinessToClient` idempotente.
- `src/lib/site-factory/project-service.ts` — criação e transição de projeto.
- `src/lib/site-factory/usage.ts` — registro no `UsageLedger`.
- `src/lib/codegen/provider.ts` — interface `CodeGenerationProvider` e tipos.
- `src/lib/codegen/manual-provider.ts` — provedor sem integração externa.
- `src/lib/codegen/registry.ts` — registro e resolução por id.
- `src/lib/content-integrity.ts` — regras anti-invenção extraídas de `demo-landing-ai.ts` e reutilizadas pelo briefing.

**API**
- `src/app/api/organizations/route.ts` — `GET` da organização ativa e membros.
- `src/app/api/organizations/members/route.ts` — `GET`/`POST`/`PATCH` de membros.
- `src/app/api/projects/route.ts` — `GET`/`POST` (assistente “Novo projeto”).
- `src/app/api/projects/[id]/route.ts` — `GET`/`PATCH` (transições de estado).
- `src/app/api/projects/[id]/brief/route.ts` — `GET`/`POST` de versões de briefing.

**UI**
- `src/app/projetos/layout.tsx` — sessão + associação verificadas no servidor.
- `src/app/projetos/page.tsx` — lista de projetos com estado.
- `src/app/projetos/novo/page.tsx` — assistente de 5 passos.
- `src/components/projetos/novo-projeto-wizard.tsx` — Setor, Leads, Negócio, Abordagem, Briefing.

**Banco**
- `prisma/schema.prisma` — novos modelos.
- `prisma/migrations/<timestamp>_fabrica_de_sites_fase_1/migration.sql` — criação + backfill da organização padrão.

**Testes**
- `tests/unit/authz.test.ts`, `site-project-states.test.ts`, `site-brief.test.ts`, `client-conversion.test.ts`, `codegen-provider.test.ts`, `projects-route.test.ts`, `demo-landing-deprecation.test.ts`, `content-integrity.test.ts`.
- `tests/unit/site-factory-db.test.ts` — integração real, pulada sem `DATABASE_URL`.

## Tarefas

1. **Regras anti-invenção compartilhadas** — extrair `FABRICATION_RULES`/`normalizeForMatching` para `content-integrity.ts`, reapontar `demo-landing-ai.ts`, garantir os 206 testes atuais verdes.
2. **Permissões** — matriz de papéis, erros tipados, DAL `server-only`, helper de rota. Testes da matriz: operador não recebe `settings:write`, `*:delete`, `publish:approve`, `org:manage_members`.
3. **Schema Prisma + migration** — `Organization`, `OrganizationMembership`, `Client`, `SiteProject`, `SiteBriefVersion`, `GenerationRun`, `SiteRevision`, `Deployment`, `Domain`, `Asset`, `UsageLedger`. Backfill: organização padrão + associação para cada usuário (admin mais antigo vira `OWNER`, demais admins `ADMIN`, operadores `OPERADOR`). `User.role` deixa de ter default privilegiado.
4. **Máquina de estados** — transições válidas, quem pode disparar cada uma, `APROVADO → PUBLICANDO` exige permissão de aprovação.
5. **Briefing versionado** — schema com fatos confirmados (`value`, `source`, `confirmedAt`), texto livre passando pelas regras anti-invenção, versão imutável e `currentBriefVersionId` no projeto.
6. **Conversão Business → Client + SiteProject** — sem copiar endereço, telefone, coordenadas ou redes sociais; `Client.businessId` único garante idempotência.
7. **Interface CodeGenerationProvider** — contrato, provedor manual, registro. Nenhuma chamada externa, nenhum segredo persistido.
8. **Rotas de API** — organizações, membros, projetos, briefing, todas atrás de `withAuthorization`.
9. **Assistente “Novo projeto”** — 5 passos, uma submissão, cria Client + SiteProject + primeira versão de briefing.
10. **Correção das permissões existentes** — `settings`, `audit/retention`, `DELETE /api/leads/[id]`, aprovação de `demo-landings`, página `/leads/users` com checagem no servidor, matcher do `proxy.ts` completo, fim dos defaults `?? "admin"`.
11. **DemoLanding em modo compatibilidade** — `POST /api/demo-landings` responde 410 salvo flag explícita; painel some com o botão de gerar; público exige `APPROVED`.
12. **Documentação** — README e `docs/arquitetura-fabrica-de-sites.md`.

## Verificação

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, e `npx prisma migrate deploy` contra o Postgres local. Baseline antes da Fase 1: tsc limpo, lint limpo, 206 testes verdes.
