# Direção de arte por categoria

> **Papel:** spec. É a autoridade sobre o que se constrói.
> **Data:** 2026-09-03
> **Contexto:** [arquitetura da fábrica de sites](2026-08-25-fabrica-de-sites-arquitetura-alvo.md)

**Objetivo:** que dois sites gerados pela fábrica não se pareçam, que nenhum
deles se pareça com uma página gerada por IA, e que o que o cliente aprova na
prévia seja o que o agente constrói no repositório.

---

## 1. O problema, com evidência

`src/components/sites/project-site.tsx` renderiza **um site só**, igual para
todo negócio. Uma barbearia, um escritório de advocacia e uma padaria saem
idênticos: fundo `#08090d`, dois gradientes radiais ciano e violeta,
glassmorphism `bg-white/[0.04]`, `rounded-[2rem]`, título com
`tracking-[-0.05em]`. `src/lib/site-factory/site-export.ts:243` reforça —
`primaryColor: "#1d4ed8"` literal para todos.

Além do template único, o markup acumula quatro marcas registradas de página
gerada:

| Tell | Onde |
| --- | --- |
| Eyebrow ALL-CAPS tracked-out acima de toda seção | `project-site.tsx`, 4 ocorrências de `uppercase tracking-[0.2em]` |
| Numeração `01 / 02 / 03` em conteúdo que não é sequência | `project-site.tsx`, `String(index + 1).padStart(2, "0")` sobre serviços |
| Metadados unidos por ponto médio | `addressText()`, `.join(" · ")` |
| `→` anexado a texto de link | `projetos/page.tsx`, `ArrowRight` em todo link |

Pior: **`src/app/projetos/[id]/preview/page.tsx` é uma duplicata quase literal
de `project-site.tsx`** — cerca de 200 linhas repetidas, com os mesmos quatro
tells, e livres para divergir a cada edição. A prévia interna e a prévia
comercial deveriam ser o mesmo site com chrome diferente. Passam a ser: a
página interna renderiza `ProjectSite` sob um cabeçalho administrativo.

O projeto já defende o **texto** contra invenção: `content-integrity.ts`
reprova depoimento, prêmio, superlativo, preço e "anos de experiência". Não
existe a defesa equivalente no **visual**. Esta spec cria essa camada.

Achado colateral: **`src/app/projetos/[id]/page.tsx` não existe.** Só existem
`[id]/geracao`, `[id]/preview` e `[id]/provisionamento`, e a listagem nunca
linka a raiz. `/projetos/<id>` responde 404.

---

## 2. Decisões

### 2.1 A direção de arte é configuração, não fato

Cor e tipografia não são afirmações sobre o cliente, então não são
`confirmedFact` e não passam pelo briefing. Mas também não podem ser inventadas
em tempo de execução por um modelo: o manifesto exige reprodutibilidade. A
direção é **função pura** — sem relógio, sem rede, sem I/O.

É a mesma distinção que o código já faz em `site-export.ts:212`: *"A section
label is configuration, not a claim about the client."*

E é exatamente a separação que o [Refero recomenda](https://styles.refero.design/ai-agents/design-resources)
para prompts de agente: *"The DESIGN.md handles taste; your brief should handle
audience, content, actions, states, and constraints."* O prompt do Cursor passa
a ter essas duas partes, nomeadas e separadas.

### 2.2 O contrato do site-kit não é versionado

`contracts/site-kit/site-content.schema.json` define `branding` com
`additionalProperties: false` e seis campos: quatro cores hex, `fontFamily ∈
{sans, serif}`, `radius ∈ {none, sm, md, lg}`. Par tipográfico, variante de hero
e ritmo não cabem ali.

**Decisão:** não versionar. Os seis campos passam a ser preenchidos pela direção
— hoje são literais. O restante da direção chega ao destino por dois caminhos
que não passam pelo contrato: o renderizador da prévia (código do NOX OS) e o
prompt do agente.

Bump para `schemaVersion 3` exigiria mexer em schema, `hashes.json`,
`invariants.json`, fixtures negativas e no pacote `@nox/site-kit`, que não vive
neste repositório e precisa poder versionar sozinho. Risco alto, ganho pequeno:
`fontFamily: sans | serif` já carrega a distinção mais pesada do conjunto.

### 2.3 Espaço de variantes, não tabela de 14 templates

Uma tabela categoria→direção deixaria duas barbearias pixel a pixel idênticas —
continua template, só que catorze.

**Decisão:** cada categoria define um espaço pequeno — 2–3 paletas, 2–3 pares
tipográficos, 2–3 composições de hero, 2–3 ritmos. Uma semente determinística
escolhe a combinação. **A semente é o `SiteProject.id`**: estável, único, já
persistido, e não é fato do cliente.

Consequência dupla, e as duas importam: o mesmo projeto rende sempre o mesmo
site — reprodutível, hashável, testável; e dois clientes da mesma categoria
rendem sites diferentes.

Nenhum modelo escolhe a direção. Um LLM no caminho tornaria a geração não
reprodutível, gastaria crédito e não poderia ser fixado por teste de contrato.

### 2.4 Orçamento de movimento apertado

> **Revisto em 2026-09-04.** O dono abriu o orçamento dentro do hero: cabem
> agora, além do momento de entrada, a entrada única do spotlight (2s) e a
> animação lenta do motivo (8 a 14s, em loop). Fora do hero, o que está
> escrito abaixo continua valendo palavra por palavra — inclusive a proibição
> de cena 3D. Veja a errata §13, item 6.

Um único momento orquestrado por site, no hero, até 200ms. Fora isso, movimento
só responde a ação da pessoa — abrir, expandir, confirmar.

Proibidos: entrada fade-and-slide-up por seção, transição de hover em todo card,
parallax, scroll-jacking, contador subindo, marquee de logos, máquina de
escrever, cena 3D (Spline). São os defaults genéricos, leem como gerado, e uma
cena 3D é um bundle indefensável num site de bairro que abre em 4G.

O [OriginKit](https://github.com/vellum-ai/originkit) e o
[21st.dev](https://21st.dev/community/components) entram como referência de
autoria — consultados para escolher *aquele um* momento — nunca como dependência
de tempo de execução. `tests/setup/no-network.ts` reprovaria qualquer chamada de
rede no pipeline, e com razão.

---

## 3. Modelo

```
src/lib/design/
  art-direction.ts   tipos + resolveArtDirection()
  catalog.ts         as 14 direções e seus espaços de variante
  category.ts        resolveCategoryId() a partir do setor em texto livre
  blocks.ts          taxonomia de blocos e variantes
  anti-slop.ts       as regras, em dois formatos
  design-md.ts       compila ArtDirection -> DESIGN.md
  tokens.ts          compila ArtDirection -> CSS custom properties
```

```ts
type ArtDirection = {
  /** Estável e legível na auditoria: "beauty/espelho-latao/v1". */
  id: string;
  categoryId: CategoryId;
  /** A âncora sensorial, uma linha. É o que mais orienta um agente. */
  anchor: string;
  ground: "light" | "dark";
  palette: {
    surface: Hex; surfaceAlt: Hex; ink: Hex; inkMuted: Hex;
    line: Hex; accent: Hex;
  };
  type: {
    display: FontToken; body: FontToken;
    scale: "compact" | "regular" | "editorial";
    displayCase: "none" | "upper";
  };
  radius: "none" | "sm" | "md" | "lg";
  rhythm: "tight" | "regular" | "airy";
  /** O único momento de movimento, ou nenhum. */
  motion: { moment: "hero-wordmark" | "hero-image" | "none"; maxMs: number };
  /** O dispositivo estrutural do mundo da categoria. */
  device: string;
  composition: BlockSpec[];
};
```

`resolveArtDirection({ sector, seed })` é pura e total: todo setor resolve, com
fallback documentado.

### 3.1 Descoberta da categoria

O briefing guarda `sector` como **texto livre** (`shortFactSchema`). O assistente
oferece os rótulos de `CATEGORY_GROUPS` como sugestão, mas o operador digita o
que quiser, e **não existe `categoryId` no projeto nem no briefing**.

`resolveCategoryId(sector)` normaliza o texto — `normalizeForMatching()` de
`content-integrity.ts`, que já remove acento e caixa — e casa contra `keywords`
e `label` dos grupos. Fallback documentado: `services`.

As listas de `keywords` em `src/lib/categories.ts` são finas demais para isso.
`professional` tem só `["contabilidade", "advocacia"]`, e "advogado",
"escritório jurídico" ou "contador" não casam. Cada grupo passa a ter uma lista
ampliada. É a única mudança em `categories.ts`, e é aditiva.

---

## 4. As 14 direções

Cada uma passou por um passo de revisão contra a lista de calibração de design
gerado por IA. A seção 4.1 registra o que mudou e por quê.

| Categoria | Âncora | Chão | Acento | Dispositivo estrutural |
| --- | --- | --- | --- | --- |
| `food` | Azulejo e cardápio do dia | `#FBFBF9` | cobalto `#1B4D8F` | lista de cardápio com pontilhado condutor |
| `beauty` | Espelho e latão sob luz baixa | `#000000` | latão `#B08D57` | simetria de fachada de barbearia |
| `fitness` | Placar de ginásio | `#E4E4E1` | sódio `#F2C200` | numeral grande, tabular |
| `pet` | Sala de espera clara | `#FCFBF9` | floresta `#3E6B52` | raio largo e consistente |
| `auto` | Manual de serviço | `#F0F0EE` | laranja `#E2571E` | tabela de especificação |
| `education` | Grade horária | `#FBFAF6` | azul-giz `#35618E` | grade de horário |
| `retail` | Vitrine e etiqueta | `#FFFFFF` | `#000000` (= tinta) | grade de imagem assimétrica |
| `events` | Passe-partout | `#F2F1EE` | `#17171A` (= tinta) | margem larga como moldura |
| `realestate` | Planta e cota | `#F5F3EF` | azul-cópia `#2B4A7A` | linha de cota com tique e número |
| `professional` | Encadernação e coluna | `#F7F7F4` | bordô `#6B2233` | lombada vertical persistente à esquerda |
| `health` | Luz difusa | `#FCFDFD` | teal `#14707E` | corpo de texto grande, contraste AAA |
| `services` | Ficha de serviço | `#FFFFFF` | azul `#1F4FD8` | lista direta |
| `tourism` | Pedra e âmbar ao entardecer | `#1F1C18` | âmbar `#9A6520` | imagem sangrada, respiro largo |
| `catalog` | Índice | `#FAFAF8` | verde `#0E6B5E` | índice com numeral tabular |

Doze direções em chão claro, duas em escuro. A proporção é deliberada: claro é o
que serve "minimalista e profissional" para negócio local, e os dois escuros
vêm do mundo da categoria — a barbearia com luz baixa, a pousada ao entardecer —
não de gosto.

Duas leituras da tabela que precisam ficar explícitas:

**A tabela é a paleta base, não a única.** Cada categoria carrega o espaço de
variantes da seção 2.3; a semente escolhe dentro dele. O que a tabela fixa é a
identidade da categoria — o mundo de onde ela vem — e é isso que nenhuma
variante move.

**`accent` é sempre um hex, nunca nulo.** Em `retail` e `events` o acento é
igual à tinta: a direção decide não ter cor de destaque, e a cor do produto ou
da fotografia faz esse trabalho. Modelar como campo anulável abriria um segundo
caminho de renderização para um caso que o valor já expressa.

### 4.1 O que a revisão mudou

| Rascunho | Problema | Revisão |
| --- | --- | --- |
| `food` em creme `#FAF6F0` + serifa display + terracota `#B4482B` | É o tell nº1 inteiro. O acento ainda cai perto de `#D97757`, cor de interação da Anthropic, que num brief de cliente lê como assinatura de IA | Azulejo: off-white frio, cobalto de majólica, e o cardápio como dispositivo — vernáculo real e brasileiro |
| `professional` como broadsheet com fios de cabelo e raio zero | Tell nº3 | Encadernação: a lombada à esquerda como dispositivo, família serifada única, sem foto de escritório no hero |
| `tourism` em pedra pálida `#F3EEE7` | Encosta no tell nº1 e repete o chão claro de sete outras | Vira o entardecer: chão marrom-escuro quente com âmbar — família monocromática coerente, não preto com neon |
| `realestate` com fios de cabelo divisores | Encosta no tell nº3 | Linha de cota com tique e número: vem da planta baixa, carrega informação, não decora |
| Cartões idênticos com um raio e uma sombra em todas as categorias | Tell nº4, o kit SaaS | Raio é decisão por direção, e sete das catorze não usam cartão nenhum |
| `auto` com monoespaçada em rótulos pequenos | Tell nº5 quando é ornamento | Monoespaçada só sobre número de peça e especificação, onde o conteúdo é tabular de verdade |

---

## 5. Blocos

Taxonomia emprestada do [21st.dev](https://21st.dev/community/components),
filtrada pelo que um fato confirmado sustenta:

`navbar` · `hero` · `differentiators` · `services` · `about` · `hours` ·
`location` · `contact` · `footer`

**Ficam de fora, por princípio:** depoimento, preço, FAQ, estatística,
nuvem de logos, selo de garantia. Todos exigem inventar conteúdo, e todos já são
reprovados no texto por `content-integrity.ts`. Um bloco que só pode ser
preenchido com invenção não entra na taxonomia.

Cada bloco só renderiza com o fato correspondente confirmado. `hours` exige
`publicContact.openingHours`; `location` exige `address`; `services` exige
briefing v2 — um v1 guarda só o nome do serviço e a página teria de ser
inventada.

A composição por categoria é o default; `brief.desiredSections` estreita ou
reordena, e uma seção pedida que não mapeia para bloco conhecido é reportada ao
operador em vez de ignorada em silêncio.

---

## 6. Regras anti-slop

Exportadas em dois formatos a partir de uma fonte só: string para a seção
`## Don't` do DESIGN.md, e asserções para o teste do markup da prévia.

> **Revisto em 2026-09-04.** As regras 1, 2, 8 e 15 abaixo foram reescritas
> pelo dono para abrir o hero — e só o hero. O texto que vale é o de
> `ANTI_SLOP_RULES`; a lista abaixo ficou como estava para que a errata §13,
> item 6, mostre o antes e o depois.

1. Sem gradiente radial ou cônico como fundo de seção.
2. Sem glow — nenhum elemento borrado atrás do conteúdo.
3. Sem glassmorphism como estilo de card (`bg-white/[0.0x]` + `backdrop-blur`).
4. Um acento só por site, em no máximo 5% da superfície.
5. Sem emoji como ícone. Sem grade de ícone genérica.
6. Um raio por site. Nada de `rounded-[2rem]` ao lado de `rounded-lg`.
7. No máximo 4 tamanhos e 3 pesos de tipo.
8. Um chão por site. Nada de hero escuro sobre corpo claro.
9. Um CTA primário por viewport.
10. Sem eyebrow ALL-CAPS tracked-out acima de seção.
11. Sem numeração `01/02/03` sobre conteúdo que não é sequência.
12. Sem metadado unido por ponto médio.
13. Sem `→` anexado a texto de link ou botão.
14. Preto é `#000000` quando a direção pede preto; nada de `#0B0B0B` ou `#111`.
15. Movimento conforme o orçamento da seção 2.4.

As regras 10 a 13 existem porque o markup atual comete as quatro.

---

## 7. Os dois emissores

Uma `ArtDirection`, dois destinos, nenhuma tradução manual entre eles.

**`toDesignMarkdown(direction)`** produz um `DESIGN.md` no formato do Refero,
que é o que um agente consome bem: `Theme`, `Tokens — Colors`,
`Tokens — Typography` com escala, `Tokens — Spacing & Shapes`, `Layout`,
`Components`, `Do's and Don'ts`, `Surfaces`, `Imagery`, `Motion`,
`Agent Prompt Guide`, e um `Quick Start` com custom properties e bloco
`@theme` do Tailwind v4.

**`toCssVariables(direction)`** produz as mesmas custom properties para o
renderizador da prévia.

Como os dois saem do mesmo objeto, a prévia que o cliente aprova e o site que o
agente constrói não podem divergir por descuido de redação.

### 7.1 O prompt

`buildGenerationPrompt` passa a emitir duas partes nomeadas:

```
# DESIGN.md          <- gosto, vindo da direção resolvida
# BRIEFING            <- fatos confirmados, como hoje
```

As duas garantias atuais do prompt seguem valendo e são a razão de o módulo de
direção ser dado estático: nada ali é inventado, e nada ali vem de fora. Uma
direção resolvida por tabela pura não abre caminho novo para valor externo. O
`brief.visualDirection` — texto livre do operador, e fato confirmado — entra
como refinamento **dentro** da direção, nomeado como tal, nunca como token.

---

## 8. Fontes

`next/font` resolve em tempo de build, então o conjunto é fixo e finito: cerca
de oito famílias, declaradas em **`src/app/sites/[id]/layout.tsx`**, fora do
layout raiz. O painel não deve baixar fonte de site de cliente.

`FontToken` é união fechada sobre esse conjunto, e um teste reprova uma direção
que referencie família fora dele.

---

## 9. Mudanças

| Ação | Arquivo |
| --- | --- |
| novo | `src/lib/design/{art-direction,catalog,category,blocks,anti-slop,design-md,tokens}.ts` |
| novo | `src/app/projetos/[id]/page.tsx` — corrige o 404 |
| novo | `src/app/sites/[id]/layout.tsx` — roster de fontes |
| reescrito | `src/components/sites/project-site.tsx` → renderizador de blocos |
| reescrito | `src/app/projetos/[id]/preview/page.tsx` → passa a renderizar `ProjectSite` |
| editado | `src/lib/generation/prompt.ts` — DESIGN.md + BRIEFING |
| editado | `src/lib/site-factory/site-export.ts` — `branding` deixa de ser literal |
| editado | `src/lib/categories.ts` — `keywords` ampliadas |
| editado | `src/app/projetos/page.tsx` — linkar a raiz do projeto |

---

## 10. Testes

Escritos antes do código.

- `resolveCategoryId` resolve as 14 categorias por rótulo e por keyword, e cai
  em `services` para setor desconhecido.
- `resolveArtDirection` é determinística: mesma entrada, mesma saída, sem tocar
  relógio nem rede.
- Toda variante referenciada no catálogo existe; todo `FontToken` está no roster.
- Contraste: `ink` sobre `surface` passa AA em toda paleta; `health` passa AAA
  no corpo.
- Duas sementes diferentes na mesma categoria produzem direções diferentes.
- Lint anti-slop sobre o markup renderizado da prévia, com as 15 regras.
- O prompt contém as duas seções nomeadas, contém a direção, e não contém
  nenhum valor que não venha do schema.
- `site-export` segue passando o contrato e as fixtures negativas **sem
  alteração de schema**.
- `/projetos/[id]` responde para projeto existente e 404 para inexistente,
  respeitando permissão.

---

## 11. Fora de escopo

- **Versionar o contrato do site-kit.** Seção 2.2.
- **Commitar o `DESIGN.md` no repositório do cliente.** Tem valor — o agente
  releria a direção em manutenção futura — mas mexe em `step-content.ts` e no
  manifesto. O prompt já carrega a direção, então não bloqueia nada. Decisão
  separada.
- **Ligar o Cursor em `LIVE`.** É Fase 6. Todo provedor nasce `DESLIGADO`;
  a direção e o prompt serão exercitados em `FALSO` e `SANDBOX`. Ligar exige
  `CURSOR_API_KEY`, permissão `integration:manage` e a auditoria da fase.
- **MCP do Refero ou do OriginKit no pipeline.** Seção 2.4.
- **Fotografia.** Nenhuma direção depende de foto para funcionar. Onde a
  composição prevê imagem, o bloco degrada para tipografia quando não há
  imagem confirmada.

---

## 12. Riscos

- **`resolveCategoryId` sobre texto livre erra.** Um setor digitado como
  "estúdio" pode cair em `fitness` ou `events`. Mitigação: o fallback é seguro,
  a resolução aparece na página do projeto, e o operador vê qual direção saiu
  antes de gerar. Não silencia.
- **A semente amarra o site ao `SiteProject.id`.** Recriar o projeto muda o
  visual. É o preço da reprodutibilidade sem persistir mais um campo, e o
  caminho de saída — persistir a direção resolvida no primeiro uso — continua
  aberto.
- **Catorze direções é bastante superfície para manter.** O teste de contraste
  e o de integridade do catálogo seguram o essencial; o resto é revisão humana.

---

## 13. Errata de execução (2026-09-04)

Divergências deliberadas entre a branch e o texto acima, cada uma com o motivo:

1. **§3/§5 — `ArtDirection` não tem campo `composition`.** É
   `resolveComposition(brief)`, função só dos fatos confirmados, então uma
   categoria nunca abre um bloco que os fatos não sustentam.
2. **§5 — `desiredSections` reporta, não estreita a composição.** Alimenta só
   o relatório `unmapped`. Estreitar foi deixado como decisão de produto: uma
   seção a menos não pode derrubar em silêncio um bloco já sustentado, como
   `hours`.
3. **§4 "dispositivo estrutural" — quatro famílias de apresentação.**
   `leader`, `index`, `spine`, `plain`, mais centralização do hero em
   `facade-symmetry`. Oito dos catorze dispositivos da tabela caem em `plain`.
4. **§8/§9 — roster de fontes num componente compartilhado.**
   `src/components/sites/site-fonts.tsx` (`<SiteFonts>`), não em
   `src/app/sites/[id]/layout.tsx`, porque `/sites/[id]` e a prévia interna
   precisam das mesmas famílias.
5. **`contact` exige canal de mensagem.** Endereço sozinho abre só
   `location`; sem telefone, WhatsApp, e-mail ou rede social, `contact` não
   abre.
6. **Hero imersivo: o dono reverteu as regras 1, 2, 8 e 15, só no hero
   (2026-09-04).** Pedido do dono do produto, com a referência na mão — o hero
   "splite" do 21st.dev: tela cheia, título display gigante à esquerda, um
   objeto visual marcante à direita e uma luz de spotlight. O que ele quis foi
   o *impacto*; o que ele recusou continua recusado: nada inventado, sem foto
   de banco, sem cena 3D genérica (um robô Spline não tem relação com uma
   pizzaria), um acento por site, sem cards genéricos, sem depoimento.

   O que mudou:

   - **§2.4 e regra 15 — o orçamento de movimento.** Além do momento único de
     entrada, o hero passa a ter a entrada de 2s do spotlight (uma vez) e a
     animação lenta do motivo (8 a 14s, em loop). Fora do hero nada anima:
     nada ao scroll, nada em hover. Tudo atrás de
     `prefers-reduced-motion: no-preference`.
   - **Regra 1 — gradiente.** Passa a ser "sem gradiente radial ou cônico fora
     do hero; o spotlight do hero é permitido uma vez".
   - **Regra 2 — glow.** Passa a ser "sem glow fora do hero e do motivo".
   - **Regra 8 — chão.** Passa a ser "no máximo dois chãos: o hero e o corpo".
     `hero: { ground }` no catálogo: `dark` em food, fitness, auto, retail e
     events; `inherit` nas outras nove — `beauty` e `tourism` já abrem no
     escuro porque a página inteira é escura.
   - **A isenção é de markup, não de prosa.** `findSlop` recorta o elemento
     `data-hero-spotlight` e o `<svg data-category-motif>` antes de medir. Um
     segundo gradiente uma seção abaixo continua reprovando, e é isso que
     torna a exceção segura de conceder. Os desenhos, medidos crus, também não
     cometem nada: o borrão do `luz-difusa` é um `feGaussianBlur` dentro do
     SVG, não um `filter: blur()` de CSS atrás do conteúdo.
   - **O objeto é gerado, não comprado.** `CategoryMotif`
     (`src/components/sites/category-motif.tsx`) desenha catorze motivos, um
     por categoria, tirados do mundo do próprio ofício — azulejo para a
     cozinha, poste e navalha para a barbearia, placar para a academia. SVG
     inline, sem raster, sem `<foreignObject>`, no máximo sessenta elementos,
     sem texto publicado (numerais decorativos são permitidos, porque não
     afirmam nada).
   - **Cinco tokens novos**, derivados em `tokens.ts`, nunca autorados uma
     segunda vez: `--hero-surface`, `--hero-ink`, `--hero-ink-muted`,
     `--hero-accent` e `--hero-spotlight`. Num hero que herda o chão, os três
     primeiros são idênticos aos do site, e é isso que deixa o renderizador
     endereçar o hero sem um segundo caminho de código. Num hero `dark`, a
     superfície é `#000000` (regra 5 continua valendo: preto é preto) e a
     paleta inverte — a `surface` clara do corpo vira a tinta do hero, e o
     tom secundário é ela a 70%.
   - **`--hero-accent` é o quinto token, e não estava no pedido.** Foi preciso:
     `retail` e `events` definem o acento igual à tinta (`#000000` e
     `#17171A`), o que sobre um hero preto é um objeto invisível. Abaixo de
     2:1 contra a superfície do hero, o acento cai para `--hero-ink` — o mesmo
     que essas duas direções já fazem no corpo, onde o acento lê como uma
     régua de tinta.
   - **`facade-symmetry` mantém o hero centrado.** As outras treze direções
     usam a grade de duas colunas; a de `beauty` empilha o motivo sob o texto,
     no eixo, porque um título empurrado para um lado é o contrário do
     dispositivo que a direção declara.
   - **`--text-display` perdeu o consumidor no renderizador.** O `<h1>` do hero
     era o único, e agora é `clamp(3rem, 8vw, 7rem)`. O passo continua sendo
     emitido: o agente que constrói o site do cliente ainda precisa de um
     tamanho display.
   - **`scripts/render-sites.ts`** entrou no repositório como ferramenta de
     revisão: renderiza uma página por categoria em HTML estático para
     captura. O linter prova o que está *ausente* do markup e nada sobre se a
     página parece feita por um designer, e o hero é o bloco onde essa é a
     pergunta inteira.

   Fora de escopo, de novo: foto do próprio negócio no lugar do motivo (quando
   confirmada) fica para a próxima iteração; cena 3D, não.

7. **Revisão do hero imersivo (2026-09-04, segunda passada).** Dois revisores e
   o dono olharam as catorze capturas. As correções, e as decisões que o
   controlador formalizou junto com elas:

   - **A isenção do linter virou allowlist por fragmento.** A primeira versão
     recortava qualquer elemento marcado antes de medir, e o marcador virou uma
     chave-mestra: slop arbitrário dentro do spotlight passava, cinco
     spotlights passavam, uma `div` marcada no rodapé isentava o rodapé,
     `class="x-data-hero-spotlight"` e `data-x="data-hero-spotlight "` contavam
     como marcador, e um elemento sem fechar silenciava o linter na página
     inteira. Agora `findSlop` (a) ancora: só ganha a concessão o fragmento que
     estiver dentro de `<section data-hero>`; (b) conta: exatamente um
     spotlight e no máximo um motivo, senão a concessão é revogada e sai um
     achado próprio (`spotlight-once`, `motif-once`); (c) concede pouco: cada
     fragmento é medido pelas quinze regras e só as concedidas a ele são
     descartadas — um `#111` ou um eyebrow em caixa alta escritos dentro do
     spotlight continuam reprovando; (d) reprova markup malformado
     (`unbalanced-exception`) em vez de devolver "limpo". O casamento do
     marcador passou a percorrer os nomes de atributo da tag, porque nenhuma
     fronteira de regex distingue um atributo de um pedaço de `class`.
   - **O cabeçalho fica no chão do hero.** Sobre as cinco direções invertidas,
     uma faixa clara no topo fazia três chãos na página e lia como banner
     colado. O `<header>` passa a usar `--hero-surface`/`--hero-ink`/
     `--hero-ink-muted`; nas nove que herdam o chão nada muda, porque os
     tokens são os mesmos. A régua inferior sai junto quando o hero é
     invertido: não há costura a esconder, e uma linha de `--line` clara seria
     um risco atravessando o topo.
   - **No chão claro o spotlight virou um foco neutro.** O acento a 18% num
     feixe de 86%×150% era uma mancha, não uma luz — o dono viu "borrão rosa
     atravessado" e reduzir a opacidade não resolveu, porque o problema era a
     geometria. No chão claro o feixe passa a 44%×90%, atrás do objeto, e
     `--hero-spotlight` resolve para a tinta da direção a 6% em vez do acento a
     18%. É a única divergência de valor em relação ao brief, e é medida: um
     matiz sobre off-white pesa muito mais do que um neutro sobre preto.
   - **A dobra do celular.** A 390×844 o hero empilhado estourava em nove
     categorias e cortava o motivo em duas. Agora o padding vertical do hero é
     `clamp(2rem, 8vw, 3.5rem)` em vez de `--space-section` (que chega a 9rem),
     o `<h1>` usa `clamp(2.6rem, 12vw, 4rem)` abaixo de 900px (e a escala do
     brief acima), e o objeto é limitado por `min(15rem, 34vh)` — sendo
     quadrado, limitar a largura limita a altura. As catorze medidas ficaram
     entre 604px e 702px, todas dentro da dobra.
   - **O objeto tem coluna garantida.** `1.1fr` é `minmax(auto, 1.1fr)`, então
     a palavra mais longa do nome do negócio virava o mínimo da coluna
     esquerda: "Consultório" empurrava o motivo para 261px, onde ele lê como
     ícone. A grade passou a `minmax(0, 1.1fr) minmax(24rem, 0.9fr)` com o
     título hifenizando quando precisa, e o `gap` do hero deixou de ser
     `--space-section` (9rem nas direções `airy` comiam a coluna) para ser
     fixo em 4rem. Os catorze motivos medem 410px no desktop; o hero centrado
     de `facade-symmetry`, 384px.
   - **Três motivos redesenhados.** `passe-partout`: a elipse de luz era larga
     o bastante para encostar no clip retangular sob um blur de 34, e uma forma
     borrada cortada em linha reta não é luz — era um bloco cinza que lia como
     imagem quebrada. A luz agora morre dentro da janela e tem um núcleo
     nítido. `luz-difusa`: seis anéis largos e sobrepostos com rampa de
     opacidade do aro ao centro, sem o ponto central — difusão é gradiente, e
     quatro anéis finos em volta de um ponto era um glifo de radar.
     `patas`: a trilha atravessa a área inteira e os círculos cresceram.
   - **Estado de repouso fora da media query.** Em `azulejo` e `patas` a
     declaração base vivia dentro de `prefers-reduced-motion: no-preference`,
     então quem pedia quietude via um desenho que ninguém desenhou (as seis
     fileiras acesas ao mesmo tempo). Só a `animation:` ficou lá dentro.
   - **Decisão do controlador, aceita e registrada:** `HeroGround` não tem o
     membro `"light"` que o brief lista. Nenhuma direção precisa dele —
     `beauty` e `tourism` já abrem no escuro porque a página inteira é escura,
     e um hero claro sobre um corpo escuro exigiria uma paleta invertida que
     ninguém confirmou. Um membro sem uso seria um ramo de código sem teste.
   - **Decisão do controlador, aceita e registrada:** `--hero-accent` é um
     quinto token, além dos quatro que o brief pede. `retail` e `events`
     definem o acento igual à tinta (`#000000` e `#17171A`), o que sobre um
     hero preto é um objeto invisível; abaixo de 2:1 contra a superfície do
     hero o acento cai para a tinta do hero. O `DESIGN.md` documenta o token e
     o CTA do hero, para que o agente não use `--accent` ali e reproduza
     justamente o defeito que o token existe para evitar.
   - **Fechado sem ação:** a franja colorida nos links da nav é antialiasing
     subpixel do Chromium no Windows, não cor de acento — as três âncoras
     herdam um único `color` e foram medidas iguais nas catorze capturas.
     `prefers-reduced-motion` foi verificado em navegador: `animationName` é
     `none` no feixe, na deriva e em todos os elementos do motivo.
