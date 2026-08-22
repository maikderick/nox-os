# NOX OS — Prospecção B2B

Plataforma web da **NOX OS** para descobrir estabelecimentos próximos com maior oportunidade de contratar um site personalizado.

## O que inclui

- Landing page pública em `/`
- Painel autenticado em `/leads` (`noindex`)
- Fontes: OpenStreetMap/Overpass + importação CSV + stub para provedor comercial licenciado (`PlacesProvider`)
- Score explicável + confiança
- Funil comercial
- Fila padrão somente com empresas sem site próprio
- Landings demonstrativas gratuitas por categoria, sem API de IA
- Melhoria editorial opcional com Claude (server-side, sempre como rascunho)
- Fotos ilustrativas licenciadas por categoria, sempre rotuladas como ilustrativas
- Publicações reais do Instagram do estabelecimento via embed oficial
- WhatsApp **manual** somente com opt-in `verified` (sem disparo automático/massa)
- Alteração da própria senha e gestão administrativa de usuários
- Deduplicação idempotente
- Política de privacidade e retenção

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Prisma + PostgreSQL/PostGIS
- NextAuth (credentials)
- Leaflet + Recharts
- Vitest + Playwright

## Instalação rápida

```bash
cd nox-os
docker compose up -d
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Acesse:

- Site: http://localhost:3000
- Login: http://localhost:3000/login
- Usuário seed: definido por `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo de 12 caracteres)

Com `DEMO_MODE=true`, o seed cria poucos registros claramente marcados como **Dados de demonstração** (não contam como leads reais na meta).

## PostgreSQL local

Se tiver Docker:

```bash
docker compose up -d
```

O `.env.example` já aponta para esse banco local:

```env
DATABASE_URL="postgresql://nox:nox@localhost:5432/nox_os?schema=public"
```

O schema e as migrations já são PostgreSQL. Rode `npx prisma migrate deploy` e depois `npm run db:seed`.

Distâncias usam Haversine na aplicação. O banco PostGIS permite evoluir índices espaciais depois.

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
Mantenha a página de importação aberta: a atualização periódica do progresso aciona novos blocos
de trabalho sem chamadas recursivas entre funções.

```bash
npm run import:csv -- ./arquivo.csv
```

**Limitações Overpass:** rate limits públicos, cobertura irregular do OSM, timeouts. Se a fonte devolver 638 empresas, a UI mostra **638 empresas reais** — nunca inventamos registros para completar a meta.

Novos registros com domínio próprio são descartados da fila. Instagram, Facebook,
WhatsApp, Linktree, marketplaces e diretórios não contam como site próprio. Se uma
nova coleta descobrir o site de um lead já salvo, o cadastro é preservado e deixa de
aparecer na fila padrão.

Atribuição: © OpenStreetMap contributors (ODbL).

## Landings demonstrativas

Na ficha de um lead elegível, use **Gerar demonstração automática**. O NOX OS cria a
prévia com templates locais por categoria, sem Claude ou outra API paga. A página:

- usa endereço aleatório em `/demo/[slug]` e validade configurável;
- exibe permanentemente **Demonstração não oficial**;
- usa `noindex`/`nofollow` e deixa de abrir após expirar;
- não gera avaliações, preços, horários ou serviços não confirmados;
- não publica telefone na página;
- só libera o link para WhatsApp após revisão e aprovação humana.

O conteúdo e o estado ficam na tabela `DemoLanding`; aplique as migrations antes de
usar o recurso em um ambiente já existente.

### Instagram do estabelecimento

Quando a ficha do lead tem um perfil do Instagram, o editor mostra o perfil e um campo para
colar o endereço de até 3 publicações públicas. A demonstração passa a exibir essas
publicações usando o **embed oficial do Instagram**.

- Nenhuma imagem é copiada: o post continua sendo servido pelo Instagram, com o nome do
  perfil e o link. Se o estabelecimento apagar ou tornar privado, some da página.
- Só o endereço de um post ou reel público é aceito. A URL do embed é reconstruída a
  partir do código da publicação, então parâmetros de rastreio colados junto são
  descartados e nada chega ao `iframe` sem validação.
- O Claude não pode alterar esse campo.

Não existe busca automática de fotos no Instagram, e isso é deliberado: desde dezembro de
2024 toda a API exige que o dono da conta autorize o aplicativo, e raspar o perfil violaria
os termos do Meta além de republicar obra de terceiro sem licença.

### Fotos ilustrativas licenciadas (opcional)

Com `PEXELS_API_KEY` configurada, **Gerar demonstração automática** também traz uma foto
de topo e três de galeria, buscadas por categoria do lead em banco de imagens com licença
aberta. No editor, **Buscar fotos ilustrativas** abre uma grade para trocar as fotos ou
definir outra imagem de topo.

- Toda foto de banco aparece na página com o rótulo **Imagem ilustrativa** e o crédito do
  fotógrafo no rodapé. Ela nunca é apresentada como foto do estabelecimento.
- Foto que você cadastrou é tratada como **Imagem fornecida** e nunca é sobrescrita pela
  busca automática. Colar uma URL própria sobre uma foto de banco converte o item para
  foto fornecida e limpa o crédito.
- Só são aceitas URLs HTTPS em `images.pexels.com`; qualquer outro host vindo da resposta
  do provedor é descartado.
- Sem chave, com o provedor fora do ar ou com resposta inválida, a demonstração é gerada
  exatamente como antes, com as composições visuais.

| Variável | Padrão | Função |
| --- | --- | --- |
| `PEXELS_API_KEY` | — | Habilita as fotos ilustrativas. |
| `PEXELS_TIMEOUT_MS` | `8000` | Timeout de cada busca. |
| `PEXELS_API_URL` | API oficial | Só para apontar a um mock local em desenvolvimento. |

Crédito obrigatório pela licença: as fotos vêm do Pexels e a página exibe o link e o nome
de cada fotógrafo.

### Melhorar com Claude (opcional)

O gerador automático continua sendo o caminho principal e gratuito. Depois de gerar a
demonstração, **Melhorar com Claude** pede ao modelo uma reescrita apenas do conteúdo
editorial. O fluxo é: gerar → melhorar → comparar → aplicar ao rascunho → salvar →
aprovar → compartilhar.

Regras aplicadas pelo servidor:

- a chamada acontece somente no servidor, com sessão autenticada e limite por hora;
- o Claude controla apenas `headline`, `subheadline`, `aboutTitle`, `about`,
  `factsTitle`, `benefits`, `servicesTitle`, `servicesIntro`, `services`,
  `galleryTitle`, `galleryIntro`, `processTitle`, `processIntro`, `processSteps`,
  `faqTitle`, `faqs`, `contactTitle`, `contactText`, `finalCtaTitle`, `finalCtaText`,
  `ctaLabel`, `primaryColor` e `accentColor`;
- `businessSnapshot`, telefone, endereço, coordenadas, redes sociais, URLs de imagens,
  slug, validade e estado de aprovação nunca são enviados para alteração;
- serviços sugeridos que não estejam confirmados na ficha são descartados;
- a resposta é validada pelo schema Zod e por regras anti-invenção (avaliações,
  preços, horários, prêmios, tempo de mercado, garantias, telefones, e-mails e URLs).
  Uma resposta reprovada é reenviada uma vez com as correções; se falhar de novo, nada
  é alterado;
- a sugestão **não é persistida**: ela volta para revisão no editor e só entra no banco
  quando você salva. Qualquer alteração de conteúdo em uma página aprovada devolve a
  demonstração para **rascunho**.

Variáveis de ambiente (defina apenas no painel da Vercel, nunca no código nem com
prefixo `NEXT_PUBLIC_`):

| Variável | Padrão | Função |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Habilita o botão. Sem ela, só o gerador gratuito aparece. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Modelo usado na Messages API. |
| `ANTHROPIC_MAX_TOKENS` | `8000` | Teto de tokens da resposta. |
| `ANTHROPIC_TIMEOUT_MS` | `45000` | Timeout de cada chamada. |
| `DEMO_AI_HOURLY_LIMIT` | `20` | Melhorias por usuário por hora (auditadas em `AuditLog`). |

Falhas do Claude (timeout, indisponibilidade, chave inválida, resposta reprovada) são
exibidas com mensagem clara e **não** alteram a demonstração — o gerador automático
continua funcionando normalmente.

## WhatsApp e consentimento

- `optInStatus`: `unknown` | `pending` | `verified` | `refused`
- Botão **Abrir WhatsApp** desabilitado sem `verified`
- Prévia editável + confirmação humana + marcação manual de envio
- Lista permanente de supressão (`Não contatar` / `refused`)

Não há fila, automação, envio em massa ou marcação automática só pelo clique.

## Usuários e senha

- **Minha conta:** qualquer usuário ativo pode alterar a própria senha informando a senha atual.
- **Usuários:** administradores podem criar contas `admin` ou `operator`, redefinir senhas e
  ativar/desativar acessos.
- Senhas novas exigem no mínimo 12 caracteres.
- O sistema impede desativar o próprio administrador ou remover o último administrador ativo.

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
```

O script `vercel-build` aplica migrations antes do build. Execute o seed uma vez, de um ambiente seguro, usando `ADMIN_EMAIL` e uma senha forte em `ADMIN_PASSWORD`. Não mantenha a senha administrativa como variável da aplicação depois do seed.

A importação Overpass usa `waitUntil`, blocos limitados a uma função de até 300 segundos e a
consulta de progresso do navegador para continuar. Isso evita requisições recursivas e o erro
`INFINITE_LOOP_DETECTED` da Vercel. Importações grandes continuam sujeitas aos limites e à
disponibilidade dos servidores públicos do Overpass.

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
