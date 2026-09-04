# NOX OS — Fábrica de sites e prospecção B2B

Plataforma web da **NOX OS** para descobrir oportunidades, confirmar um briefing e orquestrar a criação de sites com revisão e aprovação separadas.

## O que inclui

- Landing page pública em `/`
- Painel autenticado em `/leads` (`noindex`)
- Fábrica autenticada em `/projetos`, com assistente de cinco etapas
- Site de apresentação de cada projeto pronto em `/sites/[id]`, acessível sem login
- Organizações, papéis e permissões sem default administrativo
- Briefings factuais versionados e estados explícitos do projeto
- Geração por fila durável, com Cursor em modo falso ou sandbox e contabilidade de créditos
- Fontes: OpenStreetMap/Overpass + importação CSV + stub para provedor comercial licenciado (`PlacesProvider`)
- Score explicável + confiança
- Funil comercial
- Fila padrão somente com empresas sem site próprio
- Landings demonstrativas existentes preservadas em modo de compatibilidade
- Melhoria editorial opcional com Claude (server-side, sempre como rascunho)
- Fotos ilustrativas licenciadas por categoria, sempre rotuladas como ilustrativas
- Publicações reais do Instagram do estabelecimento via embed oficial
- Prompt mestre pronto para o Lovable, só com dados confirmados
- WhatsApp **manual** somente com opt-in `verified` (sem disparo automático/massa)
- Alteração da própria senha e gestão administrativa de usuários
- Deduplicação idempotente
- Política de privacidade e retenção

## Stack

- Next.js 16 (App Router, `proxy.ts`) + TypeScript
- Tailwind CSS
- Prisma + PostgreSQL/PostGIS
- NextAuth (credentials)
- Leaflet + Recharts
- Vitest + Playwright

## Instalação rápida

```bash
npm run setup:local
npm run dev:all
```

`setup:local` cria um `.env` local seguro quando necessário, instala dependências,
inicia o PostgreSQL/PostGIS, aplica migrations, semeia o banco e executa lint,
tipos, testes, build e Playwright. `dev:all` inicia o Next.js e o consumidor local
da fila; use `npm run dev` quando quiser iniciar somente a aplicação.

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

`DemoLanding` é agora um recurso de compatibilidade. As demonstrações já existentes
continuam editáveis e podem ser melhoradas, mas novos trabalhos devem começar em
`/projetos/novo`. Por padrão, `POST /api/demo-landings` responde `410 Gone`; a criação
legada só pode ser reativada deliberadamente com
`ALLOW_LEGACY_DEMO_LANDING_CREATION=true`.

Uma demonstração existente:

- usa endereço aleatório em `/demo/[slug]` e validade configurável;
- exibe permanentemente **Demonstração não oficial**;
- usa `noindex`/`nofollow` e deixa de abrir após expirar;
- não gera avaliações, preços, horários ou serviços não confirmados;
- não publica telefone na página;
- só fica pública no estado `APPROVED`; rascunhos nunca são renderizados nem redirecionados;
- só libera o link para WhatsApp após revisão e aprovação humana.

O conteúdo e o estado ficam na tabela `DemoLanding`; aplique as migrations antes de
usar o recurso em um ambiente já existente.

## Fábrica de sites

O assistente em `/projetos/novo` realiza uma única submissão com cinco passos: setor,
lead, negócio, abordagem e briefing. O servidor então:

1. converte o `Business` em `Client` de forma idempotente, mantendo endereço, telefone,
   coordenadas e redes sociais apenas no lead original;
2. cria o `SiteProject` dentro da organização ativa;
3. grava a primeira `SiteBriefVersion` imutável, com fonte e data de confirmação em cada fato;
4. move o projeto para `BRIEFING_PRONTO`.

Os quatro passos acontecem em uma única transação: ou entram juntos, ou nada é gravado.

Estados disponíveis: `RASCUNHO`, `BRIEFING_PRONTO`, `GERANDO`, `PREVIA_PRONTA`,
`EM_REVISAO`, `APROVADO`, `PUBLICANDO`, `PUBLICADO` e `FALHOU`. A máquina de estados
recusa saltos e separa transições humanas de retornos do orquestrador.
Ao chegar em `PREVIA_PRONTA`, o projeto recebe um link de apresentação em
`/sites/[id]`, sem login e com `noindex`/`nofollow`, pronto para revisão comercial com
o cliente. O painel também preserva a prévia interna autenticada. O estado
`PUBLICADO` continua reservado para a publicação definitiva; a passagem para
`PUBLICANDO` exige `publish:approve`.

Com o renderizador determinístico, o site é calculado a partir do briefing confirmado e
não espera nenhum agente: **"Gerar site"** (`project:write`) move `BRIEFING_PRONTO` para
`PREVIA_PRONTA` e é isso que abre o link público de apresentação em `/sites/[id]`. A
prévia interna autenticada depende apenas de existir briefing confirmado. A geração por
agente (`GERANDO`) continua sendo o caminho que constrói o repositório real — etapa
seguinte e opcional.

Para melhorar um site já gerado, abra o projeto → **Editar briefing** → **Salvar e voltar** →
**Gerar site**. O editor (`/projetos/[id]/briefing`) é o mesmo formulário do assistente, já
preenchido com o briefing confirmado: salvar grava a versão N+1 — as anteriores continuam no
histórico, porque uma versão é imutável — e devolve o projeto para `BRIEFING_PRONTO`. **O
endereço público de `/sites/[id]` fica indisponível enquanto o projeto está em
`BRIEFING_PRONTO`**: depois de salvar, clique em "Gerar site" outra vez para reabri-lo — é um
clique, na própria página do projeto. O link aparece em
`RASCUNHO`, `BRIEFING_PRONTO`, `PREVIA_PRONTA` e `FALHOU`, e some enquanto o agente constrói.
Briefings v1 também abrem: os campos que a v1 não guardava chegam em branco, e salvar grava
uma v2.

`GERANDO` é conduzido pela fila e pelos observadores de checks e prévia. `PUBLICANDO`
continua fechado: publicação real exige a etapa de aprovação e operação em provedores
`LIVE`, que não está habilitada neste release.

Papéis da organização: `OWNER`, `ADMIN`, `OPERADOR` e `LEITOR`. Operadores executam o
fluxo diário, mas não excluem registros, alteram configurações, gerenciam membros nem
aprovam a própria publicação. Toda rota de API resolve o autor pelo DAL e pede uma
permissão nomeada — inclusive as rotas de prospecção, importação e demonstração.

> **O beta suporta uma única organização operacional.** `Business`, `DemoLanding`,
> `ImportJob`, `AppSettings` e `AuditLog` ainda são globais, sem `organizationId`. Habilitar
> uma segunda organização exige antes escopá-los ou definir uma política formal de pool
> global com atribuição. Veja o gate em
> [a arquitetura da fábrica](docs/arquitetura-fabrica-de-sites.md).

### Direção de arte por categoria

O texto livre do setor no briefing resolve para uma de quatorze categorias. Cada
categoria tem uma direção de arte autoral — âncora sensorial, paleta, par tipográfico,
raio, ritmo de espaçamento e um dispositivo estrutural — e um espaço de variantes
(paletas, tipos e ritmos alternativos) sorteado por semente, para que dois clientes da
mesma categoria tendam a receber páginas diferentes — o espaço é pequeno, então uma
coincidência é possível, mas a identidade da categoria nunca muda.

A direção é configuração, não fato: quem resolve é uma função pura de setor +
`SiteProject.id`, nunca um modelo, então a mesma entrada rende sempre a mesma saída.
Um único objeto alimenta as duas pontas — as variáveis CSS da prévia em `/sites/[id]` e
o `DESIGN.md` que o agente de geração lê.

O hero é o único bloco com contrato próprio. Ocupa a dobra (`88vh` no desktop), com o
nome do negócio em display fluido à esquerda, uma luz de spotlight que entra uma vez, e
à direita um objeto desenhado a partir do mundo da própria categoria — azulejo para a
cozinha, poste e navalha para a barbearia, placar para a academia: catorze motivos em
SVG inline, sem foto de banco e sem cena 3D. Cinco categorias (comida, academia,
oficina, loja e eventos) abrem em preto puro sobre um corpo claro; as outras nove seguem
o chão da direção. O cabeçalho acompanha o hero, não o corpo, para que a abertura seja uma peça só. São os dois únicos chãos da página. Essa abertura reverte, só dentro
do hero, três das regras anti-slop e o orçamento de movimento — e a isenção é de markup,
recortada elemento a elemento, de modo que um segundo gradiente uma seção abaixo continua
reprovando. O pedido do dono e o que exatamente mudou estão na errata §13 da
especificação.

Quinze regras anti-slop (um acento por site, um raio por site, preto é `#000000`, sem
glow, sem gradiente radial, sem emoji como ícone) vão para o `DESIGN.md` do agente; dez
delas têm forma mecânica e são verificadas por um linter sobre o markup renderizado, e as
cinco restantes (orçamento de acento, de tipos, de chão, de CTA e de movimento) são regras
de julgamento que só o revisor confere. Os blocos da página só aparecem quando o fato por
trás deles está confirmado no briefing: sem canal de mensagem confirmado — telefone,
WhatsApp, e-mail ou rede social — não há bloco de contato; o endereço sozinho abre apenas
a localização. A página do projeto em `/projetos/[id]` mostra a direção resolvida
antes de qualquer geração.

Especificação: [direção de arte por categoria](docs/superpowers/specs/2026-09-03-direcao-de-arte-por-categoria-design.md).

## Provisionamento

Com um briefing pronto, `/projetos/[id]/provisionamento` leva o projeto por quatro
etapas — criar o repositório, publicar o conteúdo, criar a hospedagem, reconciliar
a prévia. Cada uma confere o que já existe antes de agir e é segura para repetir.

**Nada está ligado.** Todo provedor nasce `DESLIGADO` e `LIVE` não é selecionável:
o caminho roda contra implementações falsas e respostas gravadas. Ver
[o runbook](docs/runbook-provisionamento.md).

## Geração de site

Com o projeto provisionado, a geração é **pedida**, não transicionada:

```
POST /api/projects/:id/generate
Idempotency-Key: <UUID por intenção>
```

A rota cria o `GenerationRun` e enfileira o início numa transação só; o consumidor
faz o preflight e reserva o crédito antes da chamada externa. A partir daí a fila durável conduz — iniciar,
acompanhar o agente, e dois observadores irmãos (checks e prévia) que gravam o
que viram; o último a chegar fecha a geração pela barreira.

Duas coisas que valem saber antes de operar:

- **Esperar não é falhar.** Um agente gerando ou um check na fila contam
  `pollCount` e respeitam um prazo; não gastam tentativa nem caminham para carta
  morta. Estourar o prazo leva a `CONCILIACAO`, não a falha.
- **Efeito remoto nunca é repetido às cegas.** Quem decide é
  `GenerationRun.startDisposition`, gravada **antes** da chamada. Só um erro
  interno tipado autoriza chamar de novo; ambiguidade vai para uma pessoa.

`LIVE` continua indisponível e `PUBLICANDO` continua fechado. A cadeia inteira
roda em `FALSO` e em `SANDBOX`, com a rede bloqueada nos testes. Ver
[o runbook da fila](docs/runbook-fila.md).

O consumidor é uma rota com orçamento, não um worker: `GET /api/jobs/run` com
`Authorization: Bearer <CRON_SECRET>` para o agendador, e `POST` para uma pessoa
mover a fila da própria organização. Ver `infra/aws-cron/README.md`.

As telas operacionais ficam em `/projetos/[id]/geracao` e `/organizacao/fila`.
Carta morta pode ser reprocessada; conciliação exige uma decisão fechada, liquida
a reserva e registra o responsável na mesma transação.

Quando a geração terminar, a tela de geração mostra **Abrir site do cliente** e
**Copiar link**. Em desenvolvimento, o endereço copiado usa o host atual; para enviar
a alguém fora da rede local, primeiro publique o NOX OS em um domínio acessível e
abra o painel por esse domínio.

### Criar no Lovable

Na ficha, **Criar no Lovable** monta um prompt mestre a partir do que já está confirmado —
snapshot do cadastro, textos revisados, serviços confirmados, FAQ e fotos — e abre o
[Build with URL](https://docs.lovable.dev/integrations/build-with-url) do Lovable já
construindo. Não exige chave de API.

- O prompt proíbe explicitamente inventar avaliações, notas, depoimentos, prêmios, preços,
  promoções, horários, tempo de mercado, garantias e serviços não confirmados. Onde não há
  dado, ele manda **não criar a seção**.
- Fotos reais do estabelecimento e imagens ilustrativas licenciadas vão em blocos separados,
  e as ilustrativas levam a instrução de serem identificadas como tal.
- Sem telefone no cadastro, o prompt diz para não criar botão de ligar nem inventar número.
- A prévia aprovada é anexada como referência de layout quando o endereço é HTTPS.
- O prompt viaja no fragmento da URL, então não passa por nenhum servidor. Dá para revisar e
  editar antes de enviar, e a edição vale só para aquele envio.

Limites do provedor respeitados em código: 50.000 caracteres de prompt e 10 referências no
total, com as fotos reais na frente da fila caso o orçamento acabe.

Isso **não substitui** o gerador gratuito: a demonstração continua dinâmica, no PostgreSQL,
sem deploy por empresa. O Lovable é um caminho paralelo para construir o site definitivo.

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
- **Usuários:** membros com `org:manage_members` podem criar contas `admin` ou `operator`,
  redefinir senhas e ativar/desativar acessos.
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
- Rotas `/leads`, `/projetos` e APIs protegidas (`proxy.ts`, sessão e permissão viva da organização)
- Auditoria básica de sites com bloqueio SSRF
- Telefones/coordenadas não aparecem na landing pública

## Estrutura útil

- `src/lib/places` — `PlacesProvider` (Overpass, CSV, stub comercial)
- `src/lib/score.ts` — score + motivos
- `src/lib/dedupe.ts` — deduplicação
- `src/lib/whatsapp.ts` — gate de opt-in + `wa.me`
- `src/lib/authz` — papéis, permissões e DAL multi-organização
- `src/lib/site-factory` — briefing, estados e serviços de projeto
- `src/lib/codegen` — contrato e registro de provedores de geração
- `src/lib/site-factory/site-export.ts` — projeta um briefing no snapshot publicável
- `contracts/site-kit` — cópia versionada do contrato dos sites gerados
- `prisma/schema.prisma` — entidades

## Repositórios da fábrica

O site gerado não vive aqui. Ele é construído a partir de dois repositórios
irmãos, propositalmente separados para que o servidor e os sites possam ser
publicados em ritmos diferentes:

| Repositório | Papel |
| --- | --- |
| `nox-site-kit` | Pacote `@nox/site-kit`: contrato de conteúdo em Zod, tokens, componentes acessíveis, SEO e analytics. |
| `nox-site-template` | Aplicação Next.js completa que lê um snapshot validado. Cada repositório privado de cliente nasce como uma cópia dele. |

O NOX OS **não** importa o pacote. O que impede os dois lados de divergirem é a
cópia versionada dos artefatos do kit em `contracts/site-kit`, validada por
`tests/unit/site-export-contract.test.ts`. Detalhes em
[docs/arquitetura-fabrica-de-sites.md](docs/arquitetura-fabrica-de-sites.md).

## Licença de dados

Respeite ODbL (OSM), termos do Nominatim/Overpass e LGPD. Contato de privacidade configurável no painel.
