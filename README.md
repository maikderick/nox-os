# NOX OS — Prospecção B2B

Plataforma web da **NOX OS** para descobrir estabelecimentos próximos com maior oportunidade de contratar um site personalizado.

## O que inclui

- Landing page pública em `/`
- Painel autenticado em `/leads` (`noindex`)
- Fontes: OpenStreetMap/Overpass + importação CSV + stub para provedor comercial licenciado (`PlacesProvider`)
- Score explicável + confiança
- Funil comercial
- WhatsApp **manual** somente com opt-in `verified` (sem disparo automático/massa)
- Deduplicação idempotente
- Política de privacidade e retenção

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Prisma + SQLite (local) / PostgreSQL+PostGIS via Docker Compose (produção)
- NextAuth (credentials)
- Leaflet + Recharts
- Vitest + Playwright

## Instalação rápida

```bash
cd nox-os
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Acesse:

- Site: http://localhost:3000
- Login: http://localhost:3000/login
- Usuário seed: `admin@noxos.local` / `noxos-admin-123` (altere `ADMIN_PASSWORD`)

Com `DEMO_MODE=true`, o seed cria poucos registros claramente marcados como **Dados de demonstração** (não contam como leads reais na meta).

## PostgreSQL (opcional)

Se tiver Docker:

```bash
docker compose up -d
```

No `.env`:

```env
DATABASE_URL="postgresql://nox:nox@localhost:5432/nox_os?schema=public"
```

Altere `provider = "postgresql"` em `prisma/schema.prisma`, rode `npx prisma migrate dev` e o seed.

Distâncias usam Haversine na aplicação (compatível com SQLite e Postgres). Em Postgres/PostGIS você pode evoluir índices espaciais depois.

## Configurações iniciais

Painel → **Configurações** ou variáveis no `.env`:

| Campo | Default |
| --- | --- |
| Marca | NOX OS |
| Consultor | `[SEU NOME]` |
| Cidade | `[SUA CIDADE/UF]` |
| Meta | 1000 |
| Raio inicial / máx. | 5 / 80 km |
| Privacidade | `[SEU E-MAIL]` |
| Portfólio | `[URL DO PORTFÓLIO]` |
| WhatsApp NOX | `[SEU WHATSAPP]` |

Localização: autorização do navegador **ou** cidade/endereço/CEP (Nominatim, server-side).

## Importação

1. `/leads/import` → autorizar geo ou buscar endereço
2. Selecionar categorias
3. **Buscar no Overpass** (raios 5, 10, 20, 40, 80 km)
4. Ou colar/importar CSV

Controles: pausar / continuar / cancelar. Contadores: encontrados, aceitos, duplicados, rejeitados.

```bash
npm run import:csv -- ./arquivo.csv
```

**Limitações Overpass:** rate limits públicos, cobertura irregular do OSM, timeouts. Se a fonte devolver 638 empresas, a UI mostra **638 empresas reais** — nunca inventamos registros para completar a meta.

Atribuição: © OpenStreetMap contributors (ODbL).

## WhatsApp e consentimento

- `optInStatus`: `unknown` | `pending` | `verified` | `refused`
- Botão **Abrir WhatsApp** desabilitado sem `verified`
- Prévia editável + confirmação humana + pergunta se enviou
- Lista permanente de supressão (`Não contatar` / `refused`)

Não há fila, automação, envio em massa ou marcação automática só pelo clique.

## Testes

```bash
npm run test
npm run test:perf
PERF_N=10000 npm run test:perf
npx playwright install chromium
npm run build && npm run start
npm run test:e2e
npm run lint
```

## Deploy

### Vercel

```bash
npx vercel
```

Defina `DATABASE_URL` (Postgres gerenciado), `NEXTAUTH_SECRET`, `NEXTAUTH_URL` e demais vars. Rode migrations no CI/release:

```bash
npx prisma migrate deploy
npm run db:seed
```

### Node em VPS

```bash
npm ci
npx prisma migrate deploy
npm run db:seed
npm run build
npm run start
```

## Segurança

- Segredos só no backend (sem `NEXT_PUBLIC_*` para keys)
- Rotas `/leads` e APIs protegidas (middleware + session)
- Auditoria básica de sites com bloqueio SSRF
- Telefones/coordenadas não aparecem na landing pública

## Estrutura útil

- `src/lib/places` — `PlacesProvider` (Overpass, CSV, stub comercial)
- `src/lib/score.ts` — score + motivos
- `src/lib/dedupe.ts` — deduplicação
- `src/lib/whatsapp.ts` — gate de opt-in + `wa.me`
- `prisma/schema.prisma` — entidades

## Licença de dados

Respeite ODbL (OSM), termos do Nominatim/Overpass e LGPD. Contato de privacidade configurável no painel.
