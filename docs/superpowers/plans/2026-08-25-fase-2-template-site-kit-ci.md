# Fase 2 — Template oficial, site-kit e contrato do site

> **Executor:** Claude Code.  
> **Revisor de arquitetura:** ChatGPT.  
> **Pré-requisito:** Fase 1 verde e arquitetura-alvo aprovada em `docs/superpowers/specs/2026-08-25-fabrica-de-sites-arquitetura-alvo.md`.

**Objetivo:** construir a base reproduzível de todo site gerado: o pacote `@nox/site-kit`, o repositório `nox-site-template`, o contrato factual versionado, a arquitetura completa de páginas e os checks de CI. Ao final, uma cópia local do template precisa produzir um site completo, responsivo e validado sem chamar Cursor, GitHub API, Vercel API, Anthropic ou qualquer outro provedor externo.

**Arquitetura:** `@nox/site-kit` concentra contratos puros, tokens, componentes e recursos transversais. `nox-site-template` compõe esses recursos e lê um único manifesto de conteúdo público. O template carrega um tarball versionado do site-kit em `vendor/`, evitando credencial de registry no Cursor e na Vercel. O NOX OS valida e exporta o mesmo contrato, mas continua sendo a fonte de verdade; o repositório contém apenas a projeção publicável de uma versão de briefing.

**Stack:** Node 24 + npm, Next.js 16.3.2 App Router, React 19.1, TypeScript 5 strict, Tailwind v4, Zod 3, Vitest 4, Testing Library, Playwright e axe. Usar versões exatas no template e lockfile commitado. Antes de escrever Next.js, ler os guias instalados em `node_modules/next/dist/docs/`, conforme `AGENTS.md`.

## Restrições globais

- Não integrar Cursor, GitHub API, Vercel API, Anthropic ou banco do NOX OS.
- Não criar repositório de cliente, projeto Vercel, deployment ou domínio.
- Não publicar pacote em registry nesta fase.
- Não copiar segredos, dados privados de lead ou credenciais para fixture, manifesto, teste ou log.
- Não inventar serviço, preço, avaliação, depoimento, prêmio, garantia, horário, telefone, endereço ou promessa.
- Dados ausentes removem o componente correspondente; não exibem placeholder em produção.
- O template nunca lê o banco do NOX OS. Recebe somente um snapshot validado.
- Todo JSON-LD precisa corresponder ao conteúdo visível.
- Analytics começa desligado e nunca recebe PII.
- O formulário usa adaptador `disabled`/mock nesta fase; nenhuma mensagem real é enviada.
- O exemplo visual precisa estar claramente marcado como demonstração e não pode usar marcas ou dados reais.
- Preservar toda a Fase 1 e seus testes. Produção não é alterada.

## Decisões de distribuição

O código-fonte do site-kit vive em repositório separado `nox-site-kit`, com package name `@nox/site-kit`. O template inclui o artefato criado por `npm pack`:

```text
nox-site-template/vendor/nox-site-kit-0.1.0.tgz
```

e usa dependência exata:

```json
"@nox/site-kit": "file:vendor/nox-site-kit-0.1.0.tgz"
```

O tarball elimina a necessidade de `NPM_TOKEN`, torna a instalação reproduzível e impede que uma indisponibilidade de registry quebre sites existentes. `site-manifest.json` grava versão e SHA-256 do tarball. Uma fase futura pode adotar registry sem alterar os contratos públicos.

## Estrutura de repositórios

Criar como irmãos de `nox-os`, sem inicializar dentro dele:

```text
C:\Users\maikd\Downloads\LOGOS\
├── nox-os\
├── nox-site-kit\
└── nox-site-template\
```

### `nox-site-kit`

```text
src/
├── contracts/
│   ├── confirmed-fact.ts
│   ├── site-content.ts
│   ├── site-manifest.ts
│   ├── contact.ts
│   └── analytics.ts
├── components/
│   ├── site-header.tsx
│   ├── site-footer.tsx
│   ├── breadcrumbs.tsx
│   ├── service-card.tsx
│   ├── gallery.tsx
│   ├── contact-actions.tsx
│   ├── contact-form.tsx
│   ├── consent-banner.tsx
│   └── json-ld.tsx
├── analytics/
│   ├── events.ts
│   ├── provider.tsx
│   └── consent.ts
├── seo/
│   ├── metadata.ts
│   └── schemas.ts
├── styles/
│   └── tokens.css
└── index.ts
tests/
package.json
tsconfig.json
vitest.config.ts
```

Exportar subpaths separados para que contratos não importem React:

- `@nox/site-kit/contracts`
- `@nox/site-kit/components`
- `@nox/site-kit/analytics`
- `@nox/site-kit/seo`
- `@nox/site-kit/styles.css`

### `nox-site-template`

```text
app/
├── layout.tsx
├── page.tsx
├── sobre/page.tsx
├── servicos/page.tsx
├── servicos/[slug]/page.tsx
├── galeria/page.tsx
├── contato/page.tsx
├── privacidade/page.tsx
├── api/contact/route.ts
├── not-found.tsx
├── robots.ts
└── sitemap.ts
components/
content/
├── site-content.json
├── site-manifest.json
└── README.md
lib/
├── site-content.ts
├── contact-provider.ts
├── env.ts
└── absolute-url.ts
public/demo/
scripts/
├── validate-content.mjs
├── validate-manifest.mjs
├── check-internal-links.mjs
└── verify-site-kit.mjs
tests/
├── unit/
└── e2e/
vendor/
└── nox-site-kit-0.1.0.tgz
.github/workflows/ci.yml
AGENTS.md
package.json
package-lock.json
```

## Contrato de conteúdo

`site-content.json` é a única fonte de fatos publicáveis. Campos factuais usam:

```ts
type ConfirmedFact<T> = {
  value: T;
  source: "LEAD" | "OPERADOR" | "CLIENTE" | "IMPORTACAO";
  confirmedAt: string;
};
```

Contrato mínimo:

```ts
type SiteContent = {
  schemaVersion: 1;
  business: {
    name: ConfirmedFact<string>;
    legalName?: ConfirmedFact<string> | null;
    description: ConfirmedFact<string>;
    sector: ConfirmedFact<string>;
    logo?: AssetReference | null;
  };
  contact: {
    phone?: ConfirmedFact<string> | null;
    whatsapp?: ConfirmedFact<string> | null;
    email?: ConfirmedFact<string> | null;
    address?: ConfirmedFact<PostalAddress> | null;
    coordinates?: ConfirmedFact<Coordinates> | null;
    openingHours?: ConfirmedFact<OpeningHours[]> | null;
    socialLinks: ConfirmedFact<SocialLink>[];
  };
  about: {
    heading: ConfirmedFact<string>;
    body: ConfirmedFact<string>[];
  };
  services: ServiceContent[];
  gallery: AssetReference[];
  callsToAction: CallToAction[];
  branding: BrandingConfig;
  seo: SeoConfig;
  analytics: AnalyticsConfig;
  privacy: PrivacyConfig;
};
```

Texto editorial derivado também precisa ter origem verificável. Não usar `ConfirmedFact` para URLs, slugs, labels de navegação, tokens visuais ou estrutura técnica; esses campos são configuração, não afirmações sobre o cliente.

### Regras obrigatórias do schema

- `.strict()` em todos os objetos Zod.
- limites de tamanho em strings e arrays;
- strings sem HTML arbitrário;
- slugs minúsculos, únicos e com hífen;
- telefone normalizado quando presente;
- `https` para links externos, salvo `tel:`/`mailto:` gerados internamente;
- coordenadas com faixa válida;
- assets exigem `src`, `alt`, `source`, `license` e, quando aplicável, `credit`;
- serviço exige nome, slug, resumo e conteúdo confirmados;
- `schemaType` local limitado a allowlist segura;
- analytics aceita apenas ids e provedores reconhecidos, sem script customizado;
- chamadas de ação só podem apontar para rotas internas ou contatos confirmados;
- reutilizar as regras anti-invenção da Fase 1 em uma forma compartilhável, sem criar dependência do site-kit em `nox-os`.

Não duplicar regras manualmente sem teste de contrato. Gerar uma fixture comum ou JSON Schema versionado que permita testar equivalência entre o parser do NOX OS e o parser do site-kit.

## Manifesto de geração

`site-manifest.json` não contém conteúdo. Ele prova a origem da build:

```ts
type SiteManifest = {
  schemaVersion: 1;
  generatedAt: string;
  projectRef: string;
  briefVersion: number;
  factsHash: string;
  contentSha256: string;
  template: { repository: string; commitSha: string };
  siteKit: { version: string; sha256: string };
};
```

Na Fase 2, `projectRef` usa identificador de demonstração não relacionado ao banco real. Em produção futura será uma referência opaca, não um token. `factsHash` preserva a impressão digital do briefing de origem; `contentSha256` valida o snapshot publicável. Eles não são intercambiáveis.

## Arquitetura de informação

```text
Início (/)
├── Sobre (/sobre)
├── Serviços (/servicos)
│   └── [Serviço confirmado] (/servicos/[slug])
├── Galeria (/galeria)
├── Contato (/contato)
├── Política de privacidade (/privacidade)
└── 404
```

### Mapa de URLs

| Página | URL | Navegação | Prioridade | Links obrigatórios |
| --- | --- | --- | --- | --- |
| Início | `/` | header/logo | alta | serviços, serviços prioritários, sobre, contato |
| Sobre | `/sobre` | header/footer | média | contato e serviços |
| Serviços | `/servicos` | header/footer | alta | todos os serviços e contato |
| Serviço | `/servicos/[slug]` | contextual/breadcrumb | alta | hub, relacionados e contato |
| Galeria | `/galeria` | header/footer | média | contato |
| Contato | `/contato` | header/CTA/footer | alta | política de privacidade |
| Privacidade | `/privacidade` | footer/form | média | contato |
| 404 | interna | nenhuma | técnica | home e serviços |

Header limitado a Início, Sobre, Serviços, Galeria e Contato. CTA WhatsApp aparece somente com número confirmado. Breadcrumbs em todas as páginas internas, inclusive serviço. Nenhuma rota pode ficar órfã.

## Dados estruturados

Usar JSON-LD server-side, serialização segura e `@graph` quando houver múltiplos nós.

| Página | Tipos permitidos |
| --- | --- |
| Home | `WebSite`, `Organization` e, se houver dados suficientes, `LocalBusiness`/subtipo |
| Sobre | `AboutPage`, `Organization`, `BreadcrumbList` |
| Serviços | `CollectionPage`, `ItemList`, `BreadcrumbList` |
| Serviço | `Service`, `BreadcrumbList`, provider ligado à organização |
| Galeria | `CollectionPage`, `ImageObject` somente para assets exibidos |
| Contato | `ContactPage`, `BreadcrumbList`, organização |

Proibidos sem fatos visíveis correspondentes: `AggregateRating`, `Review`, `Offer`, preço, faixa de preço, horário, prêmio e garantia. Validar fixtures no Schema.org Validator; Rich Results Test é complementar porque nem todo tipo tem rich result.

## Analytics

Configuração padrão:

```json
{
  "provider": "none",
  "measurementId": null,
  "consentMode": "required"
}
```

Eventos públicos e estáveis:

| Evento | Trigger | Propriedades permitidas |
| --- | --- | --- |
| `cta_clicked` | CTA interno | `location`, `target` |
| `whatsapp_clicked` | link WhatsApp | `location`, `service_slug` |
| `phone_clicked` | link telefone | `location` |
| `map_opened` | mapa/endereço | `location` |
| `contact_form_started` | primeira interação | `form_type`, `location` |
| `contact_form_submitted` | sucesso confirmado | `form_type`, `location` |

Nome, telefone, e-mail, mensagem, endereço IP e conteúdo do formulário nunca entram em eventos. Testar ausência de PII e disparo único em navegação client-side. Não carregar analytics antes de consentimento quando `consentMode` for `required`.

## Formulário e spam

Implementar o contrato completo, mas manter entrega real desligada:

- schema Zod estrito;
- campos nome, meio de contato, mensagem e aceite da privacidade;
- honeypot invisível e acessível;
- timestamp assinado ou token de formulário para rejeitar submissão rápida/replay;
- limite de tamanho por campo e pelo body;
- normalização e escape; nenhuma renderização de HTML enviado;
- `ContactSubmissionProvider` com `disabled` e `memory-test`;
- resposta genérica para não revelar detalhes internos;
- teste de spam, body excessivo, honeypot, tempo mínimo e provider indisponível.

Proteção durável e entrega real dependem do provisionamento seguro da Fase 3. O template deve falhar fechado quando as variáveis necessárias estiverem ausentes.

## Tarefas

### 1. Bootstrap dos dois repositórios

- Criar `nox-site-kit` e `nox-site-template` como diretórios irmãos.
- Inicializar Git separadamente somente depois de confirmar os alvos absolutos.
- Usar npm e lockfile em ambos.
- Adicionar `README.md`, `LICENSE`/política proprietária definida pelo dono, `.gitignore`, `.editorconfig` e `AGENTS.md`.
- Fixar Node e scripts `typecheck`, `lint`, `test`, `build`.
- Não criar remotes nem publicar.

### 2. Contratos puros do site-kit

- Implementar schemas e tipos em `src/contracts`.
- Garantir que `@nox/site-kit/contracts` não importe React, DOM ou Next.js.
- Criar fixtures válida, mínima e inválidas por risco de invenção.
- Testar serialização estável e SHA-256 do conteúdo/manifesta.

### 3. Tokens e componentes acessíveis

- CSS variables para cor, tipografia, espaço, raio, sombra e largura.
- Componentes sem marca ou copy fixa.
- Navegação por teclado, focus visível, labels, contraste e estados vazios.
- Galeria com dimensões estáveis, alt obrigatório e crédito quando exigido.
- Componentes escondem contatos/CTA ausentes.

### 4. SEO, schema e analytics do site-kit

- Helpers puros para metadata, canonical, Open Graph e JSON-LD.
- Schemas condicionais baseados somente em fatos disponíveis.
- Provider analytics com `none` padrão e GA4 configurável.
- Consentimento antes de carregamento e API tipada de eventos.
- Testes contra PII, duplicação e dados estruturados não sustentados.

### 5. Empacotamento reproduzível

- Configurar `exports`, tipos, arquivos publicados e build do package.
- `npm pack` deve conter somente `dist`, CSS, package metadata e licença.
- Não incluir fixtures, fontes, `.env`, source maps com caminhos locais ou segredos.
- Gerar tarball `0.1.0`, calcular SHA-256 e copiar para `nox-site-template/vendor`.
- Fixar dependência `file:` e confirmar `npm ci` do zero no template.

### 6. Conteúdo e manifesto do template

- Adicionar fixture de demonstração explicitamente marcada.
- Parser server-only carrega e valida JSON uma vez.
- Build falha com erro claro para schema inválido, `contentSha256` divergente ou site-kit adulterado. O template preserva `factsHash` como proveniência, mas não tenta recalculá-lo sem o briefing original.
- Nenhum componente lê JSON cru sem passar pelo parser.
- Documentar como o NOX OS substituirá os dois arquivos no futuro.

### 7. Páginas e navegação

- Implementar todas as rotas do mapa.
- Gerar serviço individual estaticamente a partir dos slugs validados.
- Adicionar header, footer, breadcrumbs, links relacionados e 404.
- Mapa só aparece com coordenadas/endereço confirmado; preferir link externo acessível sem expor chave.
- WhatsApp e telefone só aparecem com dados confirmados.
- Garantir responsive sem overflow em 320px e alvos de toque adequados.

### 8. SEO técnico e dados estruturados

- Metadata exclusiva e canonical absoluta a partir de origem confiável configurada.
- `robots.ts` e `sitemap.ts` listam somente rotas existentes.
- Noindex quando `SITE_ENV` não for `production`.
- JSON-LD conforme tabela, com testes de ausência para fatos não fornecidos.
- Open Graph usa asset confirmado; sem imagem, omite em vez de usar fallback enganoso.

### 9. Analytics e consentimento

- Implementar configuração `none` e fixture GA4 em teste.
- Eventos da tabela e propriedades allowlisted.
- Consentimento persistido localmente sem identificador pessoal.
- Política de privacidade descreve somente provedores realmente ativos.

### 10. Formulário protegido e adaptável

- Implementar UI, route handler e providers sem envio real.
- `disabled` retorna indisponibilidade controlada; não finge sucesso.
- `memory-test` só pode carregar em teste.
- Adicionar a estrutura para segredo server-only futuro sem declará-lo no bundle.

### 11. CI e gates de qualidade

`.github/workflows/ci.yml` roda em pull request e push para main:

1. `npm ci`;
2. verificação do SHA do site-kit;
3. validação de conteúdo e manifesto;
4. typecheck;
5. lint;
6. unit/integration tests;
7. build;
8. link checker;
9. Playwright em viewport móvel e desktop;
10. axe sem violações críticas/sérias nas rotas representativas.

Nomear checks de forma estável para futura proteção de branch. Não inserir deploy no workflow.

### 12. Compatibilidade no NOX OS

- Adicionar ao `nox-os` uma cópia versionada do JSON Schema ou fixture de contrato gerada pelo site-kit.
- Teste de contrato prova que um briefing exportado pelo NOX OS é aceito pelo site-kit.
- Não adicionar endpoint de geração nem provider externo.
- Atualizar `docs/arquitetura-fabrica-de-sites.md` com link para a arquitetura-alvo e registrar que o contrato do template é `schemaVersion: 1`.

### 13. Documentação operacional

No site-kit:

- como desenvolver, testar, versionar e empacotar;
- política de breaking changes;
- inventário de exports.

No template:

- formato dos arquivos de conteúdo/manifesta;
- como executar localmente;
- quais recursos desaparecem quando faltam dados;
- como atualizar o tarball do site-kit;
- matriz de páginas, schema e eventos;
- o que Cursor poderá e não poderá editar na Fase 4.

## Testes obrigatórios

### `nox-site-kit`

- `contracts.test.ts`: válido/mínimo, strict, limites, slugs e URLs.
- `fabrication-rules.test.ts`: preço, avaliação, prêmio, garantia, horário e superlativos não confirmados.
- `seo.test.ts`: canonical, metadata e omissão de propriedades ausentes.
- `schema.test.ts`: tipos condicionais, breadcrumbs, serviço e proibições.
- `analytics.test.tsx`: consentimento, evento único, allowlist e ausência de PII.
- `components.test.tsx`: acessibilidade básica e ocultação de dados ausentes.

### `nox-site-template`

- `content.test.ts`: parser, hash, manifesto e fixture mínima.
- `routes.test.ts`: todas as rotas e slugs; serviço inexistente retorna 404.
- `metadata.test.ts`: título, descrição, canonical, OG, robots e sitemap.
- `json-ld.test.ts`: conteúdo visível e JSON-LD equivalentes.
- `contact-route.test.ts`: validação, spam, tamanho, replay e provider desligado.
- `internal-links.test.ts`: nenhuma página órfã ou link interno quebrado.
- `site-kit-integrity.test.ts`: versão e SHA do tarball.
- Playwright: home, hub de serviços, detalhe, contato, privacidade e 404 em mobile/desktop.
- axe: home, serviço e contato sem violações críticas/sérias.

### `nox-os`

- `site-export-contract.test.ts`: snapshot exportado aceito pelo schema v1.
- testes existentes continuam verdes.

## Critérios de aceite

- Dois repositórios locais separados existem e têm builds reproduzíveis.
- `npm ci` funciona em checkout limpo sem registry privado ou segredo.
- Site-kit não importa NOX OS e contratos puros não importam React/Next.
- Template renderiza todas as páginas previstas com fixture factual.
- Remover telefone, WhatsApp, endereço, mapa, galeria ou analytics do JSON remove o recurso sem quebrar build.
- Cada serviço confirmado produz exatamente uma rota e entra no sitemap.
- Nenhuma página fica órfã e páginas internas têm breadcrumbs.
- JSON-LD nunca contém dado ausente da página.
- Analytics desligado não carrega script; ligado respeita consentimento e não envia PII.
- Formulário rejeita abuso conhecido e não simula entrega quando provider está desligado.
- Site-kit, conteúdo e manifesto têm hashes verificados.
- CI local equivalente passa em ambos os repositórios.
- Fase 1 permanece com typecheck, lint, testes e build verdes.
- Nenhuma chamada externa, publicação ou segredo foi introduzido.

## Verificação final

Em `nox-site-kit`:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Em `nox-site-template`, depois de instalar o tarball exato:

```bash
npm ci
npm run verify:site-kit
npm run validate:content
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Em `nox-os`, sempre com PostgreSQL local:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Entregar um relatório com versões, hashes, total de testes, rotas renderizadas e qualquer decisão pendente. Não iniciar Fase 3 automaticamente.

## Fora de escopo

- GitHub App e criação automática de repositórios.
- Vercel SDK/API, projeto, preview, domínio ou SSL.
- Cursor Cloud Agents API, polling ou prompts reais.
- fila durável e worker externo.
- reserva ou cobrança de créditos.
- entrega real de formulário.
- aprovação, publicação e rollback no NOX OS.
- migração de `DemoLanding` para site completo.
