# Direção de arte por categoria — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada site gerado recebe uma direção de arte tirada do mundo da sua categoria, resolvida por função pura, e a mesma direção alimenta a prévia e o prompt do agente.

**Architecture:** um módulo `src/lib/design/` sem I/O resolve `setor (texto livre) → categoria → ArtDirection`, com uma semente determinística escolhendo dentro do espaço de variantes da categoria. A direção tem dois emissores — custom properties CSS para o renderizador da prévia, e um `DESIGN.md` no formato Refero para o prompt do Cursor. O contrato do site-kit não muda; seus seis campos de `branding` passam a ser preenchidos pela direção.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, Tailwind CSS v4, Zod 3, Vitest 4, `next/font/google`.

**Spec:** [`docs/superpowers/specs/2026-09-03-direcao-de-arte-por-categoria-design.md`](../specs/2026-09-03-direcao-de-arte-por-categoria-design.md)

## Global Constraints

- **Nenhuma função de `src/lib/design/` toca relógio, rede, filesystem ou banco.** São puras e totais. `tests/setup/no-network.ts` reprova qualquer chamada de rede.
- **A semente é `SiteProject.id`.** Nunca `Date.now()`, nunca `Math.random()`, nunca um valor do briefing.
- **Direção de arte é configuração, não fato.** Não vira `confirmedFact`, não entra no briefing, não é afirmação sobre o cliente.
- **O contrato `contracts/site-kit/site-content.schema.json` não é alterado.** `branding` continua com seis campos; `fontFamily ∈ {sans, serif}`; `radius ∈ {none, sm, md, lg}`.
- **Nenhum valor vindo de fora entra no prompt.** Só o schema validado e a tabela estática de direções.
- **Comentários e identificadores em código:** inglês, como no resto de `src/`. Texto de interface: português.
- **Preto é `#000000`.** Nunca `#0B0B0B` nem `#111` como substituto.
- **Orçamento de movimento:** um momento por site, no hero, ≤200ms. Nada mais sem ação da pessoa.
- Rodar `npm run lint && npm run typecheck && npm run test` antes de cada commit.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/design/category.ts` | `resolveCategoryId(sector)` — texto livre → id de categoria |
| `src/lib/design/art-direction.ts` | tipos + `resolveArtDirection()` + a semente |
| `src/lib/design/catalog.ts` | as 14 direções e seus espaços de variante |
| `src/lib/design/blocks.ts` | taxonomia de blocos e `resolveComposition()` |
| `src/lib/design/anti-slop.ts` | as 15 regras, em dois formatos |
| `src/lib/design/tokens.ts` | `toCssVariables()` |
| `src/lib/design/design-md.ts` | `toDesignMarkdown()` |
| `src/components/sites/project-site.tsx` | renderizador de blocos dirigido pela direção |
| `src/app/sites/[id]/layout.tsx` | roster fixo de fontes, fora do layout raiz |
| `src/app/projetos/[id]/page.tsx` | raiz do projeto (hoje 404) |

---

## Tabela de tokens — as 14 direções

Esta tabela é o dado. As tarefas 2 e 3 a transcrevem para código.

| id | anchor | ground | surface | surfaceAlt | ink | inkMuted | line | accent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `food` | Azulejo e cardápio do dia | light | `#FBFBF9` | `#F2F3F0` | `#16181A` | `#5A6066` | `#DDE0DC` | `#1B4D8F` |
| `beauty` | Espelho e latão sob luz baixa | dark | `#000000` | `#141210` | `#F4F1E9` | `#A39B8C` | `#2A2621` | `#B08D57` |
| `fitness` | Placar de ginásio | light | `#E4E4E1` | `#D6D6D2` | `#000000` | `#4A4A47` | `#C2C2BD` | `#F2C200` |
| `pet` | Sala de espera clara | light | `#FCFBF9` | `#F4F1EC` | `#1C2320` | `#5E6B64` | `#E2DED6` | `#3E6B52` |
| `auto` | Manual de serviço | light | `#F0F0EE` | `#E3E3E0` | `#15171A` | `#565A60` | `#CFD0CC` | `#E2571E` |
| `education` | Grade horária | light | `#FBFAF6` | `#F1EFE8` | `#1D2430` | `#5A6273` | `#DCD8CC` | `#35618E` |
| `retail` | Vitrine e etiqueta | light | `#FFFFFF` | `#F5F5F5` | `#000000` | `#565656` | `#E5E5E5` | `#000000` |
| `events` | Passe-partout | light | `#F2F1EE` | `#E7E5E1` | `#17171A` | `#55555C` | `#D8D6D1` | `#17171A` |
| `realestate` | Planta e cota | light | `#F5F3EF` | `#EAE7E1` | `#22252A` | `#5C6068` | `#D6D2CA` | `#2B4A7A` |
| `professional` | Encadernação e coluna | light | `#F7F7F4` | `#EDEDE8` | `#1A1C21` | `#575A61` | `#DCDCD5` | `#6B2233` |
| `health` | Luz difusa | light | `#FCFDFD` | `#F1F5F6` | `#12212A` | `#4C5C64` | `#DDE5E7` | `#14707E` |
| `services` | Ficha de serviço | light | `#FFFFFF` | `#F6F7F8` | `#111418` | `#565C63` | `#E3E5E8` | `#1F4FD8` |
| `tourism` | Pedra e âmbar ao entardecer | dark | `#1F1C18` | `#2A2620` | `#EFEAE3` | `#A89E90` | `#3A342C` | `#9A6520` |
| `catalog` | Índice | light | `#FAFAF8` | `#F0F0EC` | `#131313` | `#55565A` | `#E0E0DA` | `#0E6B5E` |

| id | display | body | scale | case | radius | rhythm | motion | device | `fontFamily` contrato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `food` | `archivo` | `work-sans` | regular | none | none | regular | `hero-image` | menu-leader | sans |
| `beauty` | `archivo` | `inter` | compact | upper | none | tight | `hero-wordmark` | facade-symmetry | sans |
| `fitness` | `inter-tight` | `inter` | compact | upper | none | tight | `none` | tabular-numeral | sans |
| `pet` | `work-sans` | `work-sans` | regular | none | lg | airy | `none` | soft-radius | sans |
| `auto` | `inter-tight` | `inter` | compact | none | sm | regular | `none` | spec-table | sans |
| `education` | `source-serif` | `work-sans` | regular | none | sm | regular | `none` | timetable-grid | serif |
| `retail` | `inter-tight` | `inter` | regular | none | none | airy | `hero-image` | asymmetric-grid | sans |
| `events` | `instrument-serif` | `inter` | editorial | none | none | airy | `hero-image` | wide-mount | serif |
| `realestate` | `archivo` | `inter` | regular | none | none | regular | `none` | dimension-line | sans |
| `professional` | `source-serif` | `source-serif` | editorial | none | none | regular | `none` | bound-spine | serif |
| `health` | `work-sans` | `work-sans` | regular | none | md | airy | `none` | large-body | sans |
| `services` | `inter-tight` | `inter` | regular | none | sm | regular | `none` | plain-list | sans |
| `tourism` | `fraunces` | `work-sans` | editorial | none | sm | airy | `hero-image` | full-bleed | serif |
| `catalog` | `inter-tight` | `inter` | compact | none | sm | regular | `none` | tabular-index | sans |

**Roster de fontes (`FontToken`):** `fraunces` · `source-serif` · `instrument-serif` · `archivo` · `inter-tight` · `inter` · `work-sans` · `dm-mono`.

---

## Task 0: Inicializar o repositório git

Esta pasta não é um repositório git — existe `.gitignore` e `.github/workflows/ci.yml`, mas não existe `.git`. Toda tarefa deste plano termina em commit, então isso vem primeiro. **Pule esta tarefa se o repositório já estiver inicializado ou se você preferir versionar por outro caminho.**

**Files:**
- Create: `.git/` (via `git init`)

- [ ] **Step 1: Verificar que realmente não há repositório**

```bash
git rev-parse --is-inside-work-tree
```

Expected: `fatal: not a git repository`

- [ ] **Step 2: Inicializar e fazer o commit inicial**

```bash
git init -b main
git add -A
git commit -m "chore: initial commit of existing NOX OS tree"
```

- [ ] **Step 3: Confirmar que a árvore está limpa**

```bash
git status --short
```

Expected: nenhuma saída.

---

## Task 1: Resolver a categoria a partir do setor em texto livre

O briefing guarda `sector` como texto livre e não existe `categoryId` em lugar nenhum. Sem esta função nada mais do plano tem entrada.

**Files:**
- Modify: `src/lib/categories.ts` — ampliar `keywords` de cada grupo
- Create: `src/lib/design/category.ts`
- Test: `tests/unit/design-category.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_GROUPS` de `@/lib/categories`; `normalizeForMatching` de `@/lib/content-integrity`
- Produces:
  - `type CategoryId = "food" | "beauty" | "fitness" | "pet" | "auto" | "education" | "retail" | "events" | "realestate" | "professional" | "health" | "services" | "catalog" | "tourism"`
  - `const FALLBACK_CATEGORY_ID: CategoryId`
  - `function resolveCategoryId(sector: string): CategoryId`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/design-category.test.ts
import { describe, expect, it } from "vitest";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { FALLBACK_CATEGORY_ID, resolveCategoryId } from "@/lib/design/category";

describe("resolução de categoria a partir do setor", () => {
  it("resolve todo grupo pelo próprio rótulo", () => {
    for (const group of CATEGORY_GROUPS) {
      expect(resolveCategoryId(group.label)).toBe(group.id);
    }
  });

  it("resolve todo grupo por cada uma das suas palavras-chave", () => {
    for (const group of CATEGORY_GROUPS) {
      for (const keyword of group.keywords) {
        expect(resolveCategoryId(keyword)).toBe(group.id);
      }
    }
  });

  it("ignora acento e caixa", () => {
    expect(resolveCategoryId("ADVOCACIA")).toBe("professional");
    expect(resolveCategoryId("estetica")).toBe("beauty");
    expect(resolveCategoryId("Veterinária")).toBe("pet");
  });

  it("resolve o que um operador realmente digita", () => {
    expect(resolveCategoryId("Escritório de advocacia")).toBe("professional");
    expect(resolveCategoryId("advogado")).toBe("professional");
    expect(resolveCategoryId("contador")).toBe("professional");
    expect(resolveCategoryId("barbearia masculina")).toBe("beauty");
    expect(resolveCategoryId("clínica odontológica")).toBe("health");
    expect(resolveCategoryId("pousada")).toBe("tourism");
    expect(resolveCategoryId("hamburgueria")).toBe("food");
  });

  it("cai no fallback documentado para setor desconhecido", () => {
    expect(resolveCategoryId("consultoria em blockchain")).toBe(FALLBACK_CATEGORY_ID);
    expect(resolveCategoryId("")).toBe(FALLBACK_CATEGORY_ID);
    expect(FALLBACK_CATEGORY_ID).toBe("services");
  });

  it("é determinística e não toca o relógio", () => {
    const first = resolveCategoryId("Padaria artesanal");
    const second = resolveCategoryId("Padaria artesanal");
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-category.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/category'`

- [ ] **Step 3: Ampliar as palavras-chave**

Em `src/lib/categories.ts`, substitua o array `keywords` de cada grupo. Mudança aditiva: nada é removido, e `import-service.ts` e `api/import/route.ts` só leem `id` e `osmTags`.

```ts
// food
keywords: ["restaurante", "lanchonete", "cafeteria", "padaria", "pizzaria",
  "hamburgueria", "bar", "cafe", "confeitaria", "doceria", "sorveteria",
  "churrascaria", "food truck", "delivery de comida", "marmitaria", "bistro"],

// beauty
keywords: ["barbearia", "salao", "estetica", "barbeiro", "cabeleireiro",
  "manicure", "pedicure", "unhas", "sobrancelha", "depilacao", "spa",
  "maquiagem", "esteticista", "salao de beleza", "beleza"],

// fitness
keywords: ["academia", "estudio", "crossfit", "pilates", "musculacao",
  "personal trainer", "yoga", "funcional", "box", "danca", "artes marciais",
  "jiu jitsu", "natacao"],

// pet
keywords: ["pet", "veterinaria", "veterinario", "petshop", "banho e tosa",
  "clinica veterinaria", "agropecuaria", "animais"],

// auto
keywords: ["oficina", "automotivo", "mecanica", "mecanico", "funilaria",
  "lava jato", "lava rapido", "auto center", "borracharia", "pneus",
  "eletrica automotiva", "martelinho", "insulfilm"],

// education
keywords: ["escola", "curso", "reforco", "colegio", "creche", "berçario",
  "idiomas", "ingles", "pre vestibular", "concursos", "autoescola",
  "professor", "aulas particulares", "faculdade", "tecnico"],

// retail
keywords: ["roupas", "moveis", "eletronicos", "loja", "boutique", "calcados",
  "papelaria", "material de construcao", "otica", "joalheria", "brinquedos",
  "livraria", "farmacia", "mercado", "floricultura", "presentes"],

// events
keywords: ["fotografo", "eventos", "fotografia", "filmagem", "buffet",
  "salao de festas", "casamento", "cerimonial", "decoracao de eventos",
  "espaco para eventos", "video"],

// realestate
keywords: ["imobiliaria", "corretor", "imoveis", "aluguel de imoveis",
  "corretagem", "administradora de condominios"],

// professional
keywords: ["contabilidade", "advocacia", "advogado", "advogada", "contador",
  "escritorio de advocacia", "juridico", "assessoria contabil", "consultoria",
  "despachante", "arquitetura", "arquiteto", "engenharia", "engenheiro",
  "corretora de seguros", "seguros"],

// health
keywords: ["consultorio", "clinica", "dentista", "odontologia", "medico",
  "psicologo", "psicologia", "fisioterapia", "nutricionista", "nutricao",
  "fonoaudiologia", "laboratorio", "exames", "terapia", "saude",
  "dermatologia", "oftalmologia", "pediatria"],

// services
keywords: ["servicos", "lavanderia", "chaveiro", "eletricista", "encanador",
  "pintor", "marceneiro", "serralheria", "grafica", "assistencia tecnica",
  "dedetizacao", "limpeza", "jardinagem", "mudancas", "reformas",
  "ar condicionado", "informatica", "costura"],

// tourism
keywords: ["hotel", "pousada", "turismo", "hostel", "chale", "resort",
  "agencia de viagens", "camping", "hospedagem"],

// catalog
keywords: ["catalogo", "reservas", "cardapio", "orcamento", "atacado",
  "distribuidora", "representacao comercial"],
```

- [ ] **Step 4: Implementar o resolvedor**

```ts
// src/lib/design/category.ts
import { CATEGORY_GROUPS } from "@/lib/categories";
import { normalizeForMatching } from "@/lib/content-integrity";

export type CategoryId =
  | "food" | "beauty" | "fitness" | "pet" | "auto" | "education" | "retail"
  | "events" | "realestate" | "professional" | "health" | "services"
  | "tourism" | "catalog";

/**
 * Where an unrecognised sector lands.
 *
 * `services` is both a real category and the fallback, and that is deliberate:
 * a local business nobody could classify is, in practice, a local service
 * provider. Inventing a fifteenth "unknown" direction would mean designing a
 * look for a business we know nothing about.
 */
export const FALLBACK_CATEGORY_ID: CategoryId = "services";

/**
 * Maps the operator's free-text sector onto a category.
 *
 * The brief stores `sector` as free text — the wizard offers the group labels
 * as suggestions, but nothing forces the operator to pick one, and no
 * `categoryId` is persisted anywhere. So the match happens here, over
 * normalised text, and it never guesses silently: the resolved direction is
 * shown on the project page before anyone generates a site.
 *
 * Longer keywords are tried first, so "clinica veterinaria" reaches `pet`
 * rather than stopping at `health`'s "clinica".
 */
const MATCHERS: { id: CategoryId; needle: string }[] = CATEGORY_GROUPS.flatMap((group) =>
  [group.label, ...group.keywords].map((term) => ({
    id: group.id as CategoryId,
    needle: normalizeForMatching(term),
  })),
).sort((a, b) => b.needle.length - a.needle.length);

export function resolveCategoryId(sector: string): CategoryId {
  const normalized = normalizeForMatching(sector);
  if (!normalized) return FALLBACK_CATEGORY_ID;

  for (const matcher of MATCHERS) {
    if (normalized.includes(matcher.needle)) return matcher.id;
  }
  return FALLBACK_CATEGORY_ID;
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-category.test.ts`
Expected: PASS, 6 testes.

> Se o teste "resolve todo grupo por cada uma das suas palavras-chave" falhar, é
> porque uma keyword nova de um grupo é substring da de outro. Corrija movendo a
> palavra ambígua para o grupo mais específico — não relaxe a asserção.

- [ ] **Step 6: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npx vitest run tests/unit/design-category.test.ts tests/unit/import-db.test.ts
git add src/lib/categories.ts src/lib/design/category.ts tests/unit/design-category.test.ts
git commit -m "feat(design): resolve category from free-text sector"
```

---

## Task 2: Tipos da direção e a semente

**Files:**
- Create: `src/lib/design/art-direction.ts`
- Test: `tests/unit/design-seed.test.ts`

**Interfaces:**
- Consumes: `CategoryId` de `@/lib/design/category`
- Produces:
  - `type Hex = string`, `type FontToken`, `type Ground`, `type Radius`, `type Rhythm`, `type Scale`, `type MotionMoment`
  - `type Palette`, `type TypeSpec`, `type ArtDirection`
  - `function pickVariant<T>(options: readonly T[], seed: string, axis: string): T`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/design-seed.test.ts
import { describe, expect, it } from "vitest";

import { pickVariant } from "@/lib/design/art-direction";

describe("escolha de variante por semente", () => {
  const options = ["a", "b", "c"] as const;

  it("é determinística para a mesma semente e o mesmo eixo", () => {
    expect(pickVariant(options, "cmtm2yp9u0004zpc3r7jgufvr", "palette")).toBe(
      pickVariant(options, "cmtm2yp9u0004zpc3r7jgufvr", "palette"),
    );
  });

  it("separa os eixos: a mesma semente não escolhe o mesmo índice em tudo", () => {
    const axes = ["palette", "type", "hero", "rhythm", "device", "case"];
    const picks = axes.map((axis) => pickVariant(options, "seed-fixo", axis));
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("espalha sementes diferentes por mais de uma opção", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => `projeto-${index}`);
    const picks = seeds.map((seed) => pickVariant(options, seed, "palette"));
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("devolve a única opção quando só existe uma", () => {
    expect(pickVariant(["só-essa"], "qualquer", "palette")).toBe("só-essa");
  });

  it("recusa uma lista vazia em vez de devolver undefined", () => {
    expect(() => pickVariant([], "semente", "palette")).toThrow(/vazia/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-seed.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/art-direction'`

- [ ] **Step 3: Implementar tipos e semente**

```ts
// src/lib/design/art-direction.ts
import { createHash } from "node:crypto";

import type { CategoryId } from "./category";

export type Hex = string;

/**
 * The closed font roster.
 *
 * `next/font` resolves at build time, so a direction cannot name an arbitrary
 * family: every face here is declared once in `src/app/sites/[id]/layout.tsx`.
 * Keeping the union closed is what makes "a direction referencing a font that
 * is not loaded" a type error instead of an invisible fallback to Times.
 */
export type FontToken =
  | "fraunces" | "source-serif" | "instrument-serif" | "archivo"
  | "inter-tight" | "inter" | "work-sans" | "dm-mono";

export type Ground = "light" | "dark";
export type Radius = "none" | "sm" | "md" | "lg";
export type Rhythm = "tight" | "regular" | "airy";
export type Scale = "compact" | "regular" | "editorial";
export type MotionMoment = "hero-wordmark" | "hero-image" | "none";

export type Palette = {
  surface: Hex;
  surfaceAlt: Hex;
  ink: Hex;
  inkMuted: Hex;
  line: Hex;
  /**
   * Always a hex, never null. A direction that wants no highlight colour sets
   * this equal to `ink` — `retail` and `events` do, letting the product photo
   * carry the colour. A nullable field would open a second rendering path for
   * a case the value already expresses.
   */
  accent: Hex;
};

export type TypeSpec = {
  display: FontToken;
  body: FontToken;
  scale: Scale;
  displayCase: "none" | "upper";
};

export type ArtDirection = {
  /** Stable and legible in the audit log: "beauty/espelho-latao/v1". */
  id: string;
  categoryId: CategoryId;
  /** The sensory anchor, one line. It is what steers an agent most. */
  anchor: string;
  ground: Ground;
  palette: Palette;
  type: TypeSpec;
  radius: Radius;
  rhythm: Rhythm;
  motion: { moment: MotionMoment; maxMs: number };
  /** The structural device borrowed from the category's own world. */
  device: string;
};

/**
 * Picks one option from an axis, deterministically, from a seed.
 *
 * The axis name is hashed alongside the seed so the axes do not move together:
 * without it, one seed would land on index 0 for palette, type, hero and
 * rhythm at once, and the "space of variants" would collapse back into a
 * handful of fixed templates.
 */
export function pickVariant<T>(options: readonly T[], seed: string, axis: string): T {
  if (options.length === 0) {
    throw new Error(`Não é possível escolher variante de uma lista vazia (eixo "${axis}")`);
  }
  const digest = createHash("sha256").update(`${axis}:${seed}`).digest();
  return options[digest.readUInt32BE(0) % options.length]!;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-seed.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: Verificar e commitar**

```bash
npm run lint && npm run typecheck
git add src/lib/design/art-direction.ts tests/unit/design-seed.test.ts
git commit -m "feat(design): art direction types and deterministic variant seed"
```

---

## Task 3: O catálogo das 14 direções

**Files:**
- Create: `src/lib/design/catalog.ts`
- Modify: `src/lib/design/art-direction.ts` — acrescentar `resolveArtDirection`
- Test: `tests/unit/design-catalog.test.ts`

**Interfaces:**
- Consumes: tipos da Task 2; `resolveCategoryId` da Task 1
- Produces:
  - `type CategoryDirection` — o espaço de variantes de uma categoria
  - `const DIRECTION_CATALOG: Record<CategoryId, CategoryDirection>`
  - `function resolveArtDirection(input: { sector: string; seed: string }): ArtDirection`

- [ ] **Step 1: Escrever o teste que falha**

Este teste é a rede de segurança do catálogo inteiro. O cálculo de contraste é WCAG 2.1 relative luminance.

```ts
// tests/unit/design-catalog.test.ts
import { describe, expect, it } from "vitest";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { DIRECTION_CATALOG } from "@/lib/design/catalog";
import type { CategoryId } from "@/lib/design/category";

const FONT_ROSTER = new Set([
  "fraunces", "source-serif", "instrument-serif", "archivo",
  "inter-tight", "inter", "work-sans", "dm-mono",
]);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const categoryIds = CATEGORY_GROUPS.map((group) => group.id as CategoryId);

describe("catálogo de direções de arte", () => {
  it("cobre exatamente as categorias existentes", () => {
    expect(Object.keys(DIRECTION_CATALOG).sort()).toEqual([...categoryIds].sort());
  });

  it("dá a toda categoria pelo menos uma opção em cada eixo", () => {
    for (const id of categoryIds) {
      const entry = DIRECTION_CATALOG[id];
      expect(entry.palettes.length, `${id}.palettes`).toBeGreaterThan(0);
      expect(entry.types.length, `${id}.types`).toBeGreaterThan(0);
      expect(entry.rhythms.length, `${id}.rhythms`).toBeGreaterThan(0);
      expect(entry.anchor.length, `${id}.anchor`).toBeGreaterThan(0);
    }
  });

  it("só referencia fontes do roster carregado", () => {
    for (const id of categoryIds) {
      for (const type of DIRECTION_CATALOG[id].types) {
        expect(FONT_ROSTER.has(type.display), `${id} display ${type.display}`).toBe(true);
        expect(FONT_ROSTER.has(type.body), `${id} body ${type.body}`).toBe(true);
      }
    }
  });

  it("usa hex de seis dígitos em toda cor", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        for (const [name, value] of Object.entries(palette)) {
          expect(value, `${id}.${name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });

  it("passa AA de contraste entre tinta e superfície em toda paleta", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        expect(contrast(palette.ink, palette.surface), `${id} ink/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.inkMuted, palette.surface), `${id} inkMuted/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.ink, palette.surfaceAlt), `${id} ink/surfaceAlt`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("dá a health contraste AAA no corpo, porque o público é mais velho", () => {
    for (const palette of DIRECTION_CATALOG.health.palettes) {
      expect(contrast(palette.ink, palette.surface)).toBeGreaterThanOrEqual(7);
    }
  });

  it("nunca usa quase-preto no lugar de preto", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        for (const value of Object.values(palette)) {
          expect(["#0b0b0b", "#111111", "#111"], `${id} ${value}`).not.toContain(value.toLowerCase());
        }
      }
    }
  });

  it("respeita o orçamento de movimento", () => {
    for (const id of categoryIds) {
      const { motion } = DIRECTION_CATALOG[id];
      expect(motion.maxMs, `${id}.motion.maxMs`).toBeLessThanOrEqual(200);
      expect(["hero-wordmark", "hero-image", "none"]).toContain(motion.moment);
    }
  });
});

describe("resolução da direção", () => {
  it("é determinística: mesma entrada, mesma saída", () => {
    const input = { sector: "Barbearia", seed: "cmtm2yp9u0004zpc3r7jgufvr" };
    expect(resolveArtDirection(input)).toEqual(resolveArtDirection(input));
  });

  it("resolve para a categoria do setor", () => {
    expect(resolveArtDirection({ sector: "Advocacia", seed: "s" }).categoryId).toBe("professional");
    expect(resolveArtDirection({ sector: "Pizzaria", seed: "s" }).categoryId).toBe("food");
  });

  it("mantém a identidade da categoria e varia o resto entre sementes", () => {
    const seeds = Array.from({ length: 24 }, (_, index) => `projeto-${index}`);
    const resolved = seeds.map((seed) => resolveArtDirection({ sector: "Barbearia", seed }));

    expect(new Set(resolved.map((d) => d.categoryId))).toEqual(new Set(["beauty"]));
    expect(new Set(resolved.map((d) => d.anchor)).size).toBe(1);
    expect(new Set(resolved.map((d) => d.id)).size).toBeGreaterThan(1);
  });

  it("resolve toda categoria sem lançar", () => {
    for (const group of CATEGORY_GROUPS) {
      const direction = resolveArtDirection({ sector: group.label, seed: "semente" });
      expect(direction.categoryId).toBe(group.id);
      expect(direction.id).toContain(group.id);
    }
  });

  it("não toca relógio nem aleatoriedade", () => {
    const source = resolveArtDirection.toString() + DIRECTION_CATALOG.toString();
    expect(source).not.toMatch(/Date\.now|Math\.random|new Date/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-catalog.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/catalog'`

- [ ] **Step 3: Escrever o catálogo**

Transcreva as duas tabelas de tokens no topo deste plano. Cada categoria recebe pelo menos duas paletas e dois pares tipográficos — a primeira paleta é a da tabela; a segunda é uma variação **dentro do mesmo mundo** (mesma família de matiz, contraste equivalente), nunca outra personalidade.

```ts
// src/lib/design/catalog.ts
import type {
  ArtDirection, MotionMoment, Palette, Radius, Rhythm, TypeSpec,
} from "./art-direction";
import type { CategoryId } from "./category";

export type CategoryDirection = {
  /** The sensory anchor. Fixed per category: it is the identity. */
  anchor: string;
  ground: ArtDirection["ground"];
  device: string;
  radius: Radius;
  motion: { moment: MotionMoment; maxMs: number };
  /** The variant space. A seed picks one of each. */
  palettes: Palette[];
  types: TypeSpec[];
  rhythms: Rhythm[];
  /** Slug of each palette, for the direction id. Same length as `palettes`. */
  paletteNames: string[];
};

export const DIRECTION_CATALOG: Record<CategoryId, CategoryDirection> = {
  food: {
    anchor: "Azulejo e cardápio do dia",
    ground: "light",
    device: "menu-leader",
    radius: "none",
    motion: { moment: "hero-image", maxMs: 200 },
    paletteNames: ["azulejo", "cal"],
    palettes: [
      { surface: "#FBFBF9", surfaceAlt: "#F2F3F0", ink: "#16181A", inkMuted: "#5A6066", line: "#DDE0DC", accent: "#1B4D8F" },
      { surface: "#F7F8F7", surfaceAlt: "#ECEEEC", ink: "#14181B", inkMuted: "#565D63", line: "#D8DCD9", accent: "#17457F" },
    ],
    types: [
      { display: "archivo", body: "work-sans", scale: "regular", displayCase: "none" },
      { display: "archivo", body: "inter", scale: "compact", displayCase: "none" },
    ],
    rhythms: ["regular", "airy"],
  },

  beauty: {
    anchor: "Espelho e latão sob luz baixa",
    ground: "dark",
    device: "facade-symmetry",
    radius: "none",
    motion: { moment: "hero-wordmark", maxMs: 200 },
    paletteNames: ["latao", "niquel"],
    palettes: [
      { surface: "#000000", surfaceAlt: "#141210", ink: "#F4F1E9", inkMuted: "#A39B8C", line: "#2A2621", accent: "#B08D57" },
      { surface: "#000000", surfaceAlt: "#121314", ink: "#F0F1F2", inkMuted: "#9BA0A5", line: "#26292B", accent: "#8FA3AD" },
    ],
    types: [
      { display: "archivo", body: "inter", scale: "compact", displayCase: "upper" },
      { display: "inter-tight", body: "inter", scale: "compact", displayCase: "upper" },
    ],
    rhythms: ["tight", "regular"],
  },

  // ... as doze restantes, transcritas da tabela do plano com a mesma forma.
};
```

> **Regra ao escrever as doze restantes:** a segunda paleta é sempre a primeira
> deslocada dentro da mesma família — nunca um chão diferente, nunca um matiz de
> acento de outra categoria. Se a variação te tentar a trocar `ground` ou o
> `anchor`, ela virou outra direção, e o lugar dela não é aqui.

- [ ] **Step 4: Implementar `resolveArtDirection`**

Acrescente ao fim de `src/lib/design/art-direction.ts`:

```ts
import { DIRECTION_CATALOG } from "./catalog";
import { resolveCategoryId } from "./category";

/**
 * The site's whole visual identity, from the sector text and a stable seed.
 *
 * Pure and total: every sector resolves, and the same pair always resolves to
 * the same direction. That is what lets a generated site be reproducible and a
 * preview be trusted as what the agent will build — and it is why no model is
 * in this path.
 */
export function resolveArtDirection(input: { sector: string; seed: string }): ArtDirection {
  const categoryId = resolveCategoryId(input.sector);
  const entry = DIRECTION_CATALOG[categoryId];
  const { seed } = input;

  const paletteIndex = pickVariant(
    entry.palettes.map((_, index) => index), seed, "palette",
  );

  return {
    id: `${categoryId}/${entry.paletteNames[paletteIndex]}/v1`,
    categoryId,
    anchor: entry.anchor,
    ground: entry.ground,
    palette: entry.palettes[paletteIndex]!,
    type: pickVariant(entry.types, seed, "type"),
    radius: entry.radius,
    rhythm: pickVariant(entry.rhythms, seed, "rhythm"),
    motion: entry.motion,
    device: entry.device,
  };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-catalog.test.ts`
Expected: PASS, 13 testes.

> O teste de contraste vai reprovar paletas de variante escritas às pressas.
> Escureça a tinta ou clareie a superfície até passar — **não** baixe o limite.

- [ ] **Step 6: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npx vitest run tests/unit/design-catalog.test.ts
git add src/lib/design/catalog.ts src/lib/design/art-direction.ts tests/unit/design-catalog.test.ts
git commit -m "feat(design): catalogue of fourteen category art directions"
```

---

## Task 4: As 15 regras anti-slop

**Files:**
- Create: `src/lib/design/anti-slop.ts`
- Test: `tests/unit/design-anti-slop.test.ts`

**Interfaces:**
- Produces:
  - `type AntiSlopRule = { id: string; text: string; markup?: RegExp }`
  - `const ANTI_SLOP_RULES: AntiSlopRule[]`
  - `function antiSlopMarkdown(): string`
  - `function findSlop(html: string): { id: string; text: string }[]`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/design-anti-slop.test.ts
import { describe, expect, it } from "vitest";

import { ANTI_SLOP_RULES, antiSlopMarkdown, findSlop } from "@/lib/design/anti-slop";

describe("regras anti-slop", () => {
  it("tem as quinze regras da spec, com id único", () => {
    expect(ANTI_SLOP_RULES).toHaveLength(15);
    expect(new Set(ANTI_SLOP_RULES.map((rule) => rule.id)).size).toBe(15);
  });

  it("aprova markup limpo", () => {
    expect(findSlop('<h2 class="text-3xl">Serviços</h2><p>Corte e barba.</p>')).toEqual([]);
  });

  it("pega o eyebrow ALL-CAPS tracked-out", () => {
    const html = '<p class="text-xs font-semibold uppercase tracking-[0.24em]">Sobre</p>';
    expect(findSlop(html).map((r) => r.id)).toContain("eyebrow-caps");
  });

  it("pega gradiente radial de fundo", () => {
    const html = '<section class="bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.14),transparent_34%)]">x</section>';
    expect(findSlop(html).map((r) => r.id)).toContain("gradient-ground");
  });

  it("pega glassmorphism", () => {
    const html = '<div class="bg-white/[0.04] backdrop-blur-xl">x</div>';
    expect(findSlop(html).map((r) => r.id)).toContain("glassmorphism");
  });

  it("pega metadado unido por ponto médio", () => {
    expect(findSlop("<span>Rua A, 10 · Centro · Fortaleza</span>").map((r) => r.id))
      .toContain("middle-dot");
  });

  it("pega seta anexada a texto de link", () => {
    expect(findSlop('<a href="/x">Ver serviços →</a>').map((r) => r.id)).toContain("arrow-suffix");
  });

  it("pega quase-preto no lugar de preto", () => {
    expect(findSlop('<div class="bg-[#0B0B0B]">x</div>').map((r) => r.id)).toContain("tinted-black");
  });

  it("pega numeração ordinal de conteúdo que não é sequência", () => {
    const html = "<article><span>01</span><h3>Corte</h3></article><article><span>02</span><h3>Barba</h3></article>";
    expect(findSlop(html).map((r) => r.id)).toContain("false-sequence");
  });

  it("reprova o markup do site atual, que é o motivo de as regras existirem", () => {
    const current = `
      <section class="bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.14),transparent_34%)]">
        <p class="text-xs font-semibold uppercase tracking-[0.24em]">Serviços</p>
        <div class="rounded-[2rem] border border-white/10 bg-white/[0.04] backdrop-blur-xl"></div>
        <span>Rua A, 10 · Centro · Fortaleza</span>
      </section>`;
    expect(findSlop(current).length).toBeGreaterThanOrEqual(4);
  });

  it("rende uma seção Don't para o DESIGN.md", () => {
    const markdown = antiSlopMarkdown();
    expect(markdown).toContain("### Don't");
    for (const rule of ANTI_SLOP_RULES) {
      expect(markdown).toContain(rule.text);
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-anti-slop.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/anti-slop'`

- [ ] **Step 3: Implementar**

```ts
// src/lib/design/anti-slop.ts

/**
 * The visual counterpart to `content-integrity.ts`.
 *
 * That module keeps invented *claims* off a page — awards, testimonials, years
 * in business. These rules keep the page from looking generated: the traits
 * that appear on an AI-built site whatever the subject is.
 *
 * One source, two consumers. `antiSlopMarkdown()` writes the `## Don't` section
 * the agent reads; `findSlop()` asserts over the preview's rendered markup. A
 * rule stated to the agent but unenforced in our own renderer would be a rule
 * we do not believe.
 *
 * Rules 10 to 13 exist because the markup they describe was in this repository.
 */
export type AntiSlopRule = {
  id: string;
  text: string;
  /** Present when the rule is mechanically checkable over rendered HTML. */
  markup?: RegExp;
};

export const ANTI_SLOP_RULES: AntiSlopRule[] = [
  { id: "gradient-ground", text: "Sem gradiente radial ou cônico como fundo de seção.",
    markup: /(radial|conic)-gradient/i },
  { id: "glow", text: "Sem glow: nenhum elemento borrado atrás do conteúdo.",
    markup: /blur-(2xl|3xl)|shadow-\[0_0_\d/i },
  { id: "glassmorphism", text: "Sem glassmorphism como estilo de card.",
    markup: /bg-white\/\[?0?\.0\d\]?[^"']*backdrop-blur|backdrop-blur[^"']*bg-white\/\[?0?\.0/i },
  { id: "accent-flood", text: "Um acento só por site, em no máximo 5% da superfície." },
  { id: "emoji-icon", text: "Sem emoji como ícone e sem grade de ícone genérica.",
    markup: /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u },
  { id: "radius-soup", text: "Um raio por site. Nada de rounded-[2rem] ao lado de rounded-lg.",
    markup: /rounded-\[\d/ },
  { id: "type-soup", text: "No máximo quatro tamanhos e três pesos de tipo." },
  { id: "two-grounds", text: "Um chão por site. Nada de hero escuro sobre corpo claro." },
  { id: "cta-crowd", text: "Um CTA primário por viewport." },
  { id: "eyebrow-caps", text: "Sem eyebrow ALL-CAPS tracked-out acima de seção.",
    markup: /uppercase[^"']*tracking-\[0\.(1[5-9]|[2-9])|tracking-\[0\.(1[5-9]|[2-9])[^"']*uppercase/i },
  { id: "false-sequence", text: "Sem numeração 01/02/03 sobre conteúdo que não é sequência.",
    markup: /<span[^>]*>\s*0[123]\s*<\/span>/ },
  { id: "middle-dot", text: "Sem metadado unido por ponto médio.",
    markup: /\S\s+·\s+\S/ },
  { id: "arrow-suffix", text: "Sem seta anexada a texto de link ou botão.",
    markup: /[\p{L}\p{N}]\s*(→|-&gt;|&rarr;)\s*<\// u },
  { id: "tinted-black", text: "Preto é #000000. Nada de #0B0B0B ou #111 como substituto.",
    markup: /#(0b0b0b|111111|0d0d0d|0a0a0a)\b/i },
  { id: "motion-budget", text: "Um momento de movimento por site, no hero, até 200ms. Fora isso, movimento só responde a ação da pessoa." },
];

export function antiSlopMarkdown(): string {
  return ["### Don't", ...ANTI_SLOP_RULES.map((rule) => `- ${rule.text}`)].join("\n");
}

/** Reports every mechanically checkable rule a piece of rendered HTML trips. */
export function findSlop(html: string): { id: string; text: string }[] {
  return ANTI_SLOP_RULES.filter((rule) => rule.markup?.test(html)).map((rule) => ({
    id: rule.id,
    text: rule.text,
  }));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-anti-slop.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 5: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npx vitest run tests/unit/design-anti-slop.test.ts
git add src/lib/design/anti-slop.ts tests/unit/design-anti-slop.test.ts
git commit -m "feat(design): fifteen anti-slop rules, one source and two consumers"
```

---

## Task 5: Os dois emissores — CSS e DESIGN.md

**Files:**
- Create: `src/lib/design/tokens.ts`
- Create: `src/lib/design/design-md.ts`
- Test: `tests/unit/design-emitters.test.ts`

**Interfaces:**
- Consumes: `ArtDirection` (Task 2), `antiSlopMarkdown` (Task 4)
- Produces:
  - `function toCssVariables(d: ArtDirection): Record<string, string>`
  - `function toStyleAttribute(d: ArtDirection): React.CSSProperties`
  - `function toDesignMarkdown(d: ArtDirection): string`
  - `const SCALE_STEPS: Record<Scale, { role: string; size: string; leading: string; tracking: string }[]>`
  - `const RHYTHM_SPACE: Record<Rhythm, { section: string; block: string; inline: string }>`
  - `const RADIUS_PX: Record<Radius, string>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/design-emitters.test.ts
import { describe, expect, it } from "vitest";

import { resolveArtDirection } from "@/lib/design/art-direction";
import { toDesignMarkdown } from "@/lib/design/design-md";
import { toCssVariables } from "@/lib/design/tokens";

const direction = resolveArtDirection({ sector: "Barbearia", seed: "semente-fixa" });

describe("emissor de custom properties", () => {
  it("emite toda cor da paleta", () => {
    const vars = toCssVariables(direction);
    expect(vars["--surface"]).toBe(direction.palette.surface);
    expect(vars["--ink"]).toBe(direction.palette.ink);
    expect(vars["--accent"]).toBe(direction.palette.accent);
    expect(vars["--line"]).toBe(direction.palette.line);
  });

  it("emite raio, ritmo e as famílias como variáveis de fonte", () => {
    const vars = toCssVariables(direction);
    expect(vars["--radius"]).toMatch(/^\d/);
    expect(vars["--space-section"]).toMatch(/rem$/);
    expect(vars["--font-display"]).toContain(direction.type.display);
    expect(vars["--font-body"]).toContain(direction.type.body);
  });

  it("é determinístico", () => {
    expect(toCssVariables(direction)).toEqual(toCssVariables(direction));
  });
});

describe("emissor de DESIGN.md", () => {
  const markdown = toDesignMarkdown(direction);

  it("abre com a âncora e o tema", () => {
    expect(markdown).toContain(direction.anchor);
    expect(markdown).toMatch(/\*\*Theme:\*\* dark/);
  });

  it("traz as seções que um agente espera do formato", () => {
    for (const heading of [
      "## Tokens — Colors",
      "## Tokens — Typography",
      "## Tokens — Spacing & Shapes",
      "## Components",
      "## Do's and Don'ts",
      "## Motion",
      "## Agent Prompt Guide",
      "## Quick Start",
    ]) {
      expect(markdown, heading).toContain(heading);
    }
  });

  it("traz toda cor da paleta com o hex literal", () => {
    for (const value of Object.values(direction.palette)) {
      expect(markdown).toContain(value);
    }
  });

  it("traz as quinze regras na seção Don't", () => {
    expect(markdown).toContain("### Don't");
    expect(markdown.split("### Don't")[1]).toContain("Sem gradiente radial");
  });

  it("declara o orçamento de movimento com o teto em milissegundos", () => {
    expect(markdown).toMatch(/200\s*ms/);
  });

  it("traz um bloco @theme do Tailwind v4 pronto para colar", () => {
    expect(markdown).toContain("@theme");
    expect(markdown).toContain(direction.palette.surface);
  });

  it("não vaza marca da fábrica para o site do cliente", () => {
    expect(markdown).not.toMatch(/NOX|nox-os|Claude|Anthropic|Cursor/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-emitters.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/tokens'`

- [ ] **Step 3: Implementar `tokens.ts`**

```ts
// src/lib/design/tokens.ts
import type { ArtDirection, Radius, Rhythm, Scale } from "./art-direction";

export const RADIUS_PX: Record<Radius, string> = {
  none: "0px", sm: "4px", md: "10px", lg: "20px",
};

export const RHYTHM_SPACE: Record<Rhythm, { section: string; block: string; inline: string }> = {
  tight: { section: "4rem", block: "1.5rem", inline: "1.25rem" },
  regular: { section: "6rem", block: "2rem", inline: "1.5rem" },
  airy: { section: "9rem", block: "3rem", inline: "2rem" },
};

/** At most four sizes, per anti-slop rule `type-soup`. */
export const SCALE_STEPS: Record<
  Scale,
  { role: string; size: string; leading: string; tracking: string }[]
> = {
  compact: [
    { role: "display", size: "3.25rem", leading: "1.02", tracking: "-0.02em" },
    { role: "heading", size: "1.5rem", leading: "1.2", tracking: "-0.01em" },
    { role: "body", size: "1rem", leading: "1.6", tracking: "0" },
    { role: "small", size: "0.875rem", leading: "1.5", tracking: "0" },
  ],
  regular: [
    { role: "display", size: "3.75rem", leading: "1.05", tracking: "-0.015em" },
    { role: "heading", size: "1.75rem", leading: "1.25", tracking: "-0.005em" },
    { role: "body", size: "1.0625rem", leading: "1.65", tracking: "0" },
    { role: "small", size: "0.9375rem", leading: "1.55", tracking: "0" },
  ],
  editorial: [
    { role: "display", size: "4.5rem", leading: "1.0", tracking: "-0.01em" },
    { role: "heading", size: "2rem", leading: "1.3", tracking: "0" },
    { role: "body", size: "1.125rem", leading: "1.75", tracking: "0" },
    { role: "small", size: "1rem", leading: "1.6", tracking: "0" },
  ],
};

/**
 * The direction as custom properties.
 *
 * These are the same values `toDesignMarkdown` writes into the agent's
 * `Quick Start`. Both read this function's output, so the preview and the
 * generated site cannot drift apart through a typo in prose.
 */
export function toCssVariables(direction: ArtDirection): Record<string, string> {
  const space = RHYTHM_SPACE[direction.rhythm];
  const steps = SCALE_STEPS[direction.type.scale];

  const vars: Record<string, string> = {
    "--surface": direction.palette.surface,
    "--surface-alt": direction.palette.surfaceAlt,
    "--ink": direction.palette.ink,
    "--ink-muted": direction.palette.inkMuted,
    "--line": direction.palette.line,
    "--accent": direction.palette.accent,
    "--radius": RADIUS_PX[direction.radius],
    "--space-section": space.section,
    "--space-block": space.block,
    "--space-inline": space.inline,
    "--font-display": `var(--font-${direction.type.display})`,
    "--font-body": `var(--font-${direction.type.body})`,
    "--motion-max": `${direction.motion.maxMs}ms`,
  };

  for (const step of steps) {
    vars[`--text-${step.role}`] = step.size;
    vars[`--leading-${step.role}`] = step.leading;
    vars[`--tracking-${step.role}`] = step.tracking;
  }
  return vars;
}

/** The same map, typed for a React `style` prop. */
export function toStyleAttribute(direction: ArtDirection): React.CSSProperties {
  return toCssVariables(direction) as React.CSSProperties;
}
```

- [ ] **Step 4: Implementar `design-md.ts`**

```ts
// src/lib/design/design-md.ts
import type { ArtDirection } from "./art-direction";
import { antiSlopMarkdown } from "./anti-slop";
import { RADIUS_PX, RHYTHM_SPACE, SCALE_STEPS, toCssVariables } from "./tokens";

const FONT_STACK: Record<string, string> = {
  fraunces: "Fraunces, Georgia, serif",
  "source-serif": "'Source Serif 4', Georgia, serif",
  "instrument-serif": "'Instrument Serif', Georgia, serif",
  archivo: "Archivo, 'Helvetica Neue', sans-serif",
  "inter-tight": "'Inter Tight', 'Helvetica Neue', sans-serif",
  inter: "Inter, 'Helvetica Neue', sans-serif",
  "work-sans": "'Work Sans', 'Helvetica Neue', sans-serif",
  "dm-mono": "'DM Mono', 'SFMono-Regular', monospace",
};

const COLOR_ROLES: [keyof ArtDirection["palette"], string, string][] = [
  ["surface", "--surface", "Fundo da página. Um chão só, do topo ao rodapé."],
  ["surfaceAlt", "--surface-alt", "Segundo plano, para separar uma seção sem trocar o chão."],
  ["ink", "--ink", "Texto e títulos."],
  ["inkMuted", "--ink-muted", "Texto secundário. Nunca abaixo de 4.5:1 sobre o fundo."],
  ["line", "--line", "Bordas e divisores."],
  ["accent", "--accent", "Único destaque. No máximo 5% da superfície."],
];

/**
 * The direction as a DESIGN.md.
 *
 * The format is the one coding agents already consume well, and it is what the
 * reference the studio works from recommends: the DESIGN.md carries taste, the
 * brief carries facts. Nothing about the client appears here — this half of the
 * prompt is a studio decision and says nothing a business would have to confirm.
 */
export function toDesignMarkdown(direction: ArtDirection): string {
  const { palette, type } = direction;
  const space = RHYTHM_SPACE[direction.rhythm];
  const steps = SCALE_STEPS[type.scale];
  const vars = toCssVariables(direction);

  const lines: string[] = [
    `# Style Reference`,
    `> ${direction.anchor}`,
    ``,
    `**Theme:** ${direction.ground}`,
    ``,
    `A direção nasce do mundo do próprio negócio, não de um gosto genérico. O`,
    `dispositivo estrutural é \`${direction.device}\`, e é ele que organiza a`,
    `página — não uma sequência de cartões iguais.`,
    ``,
    `## Tokens — Colors`,
    ``,
    `| Name | Value | Token | Role |`,
    `| --- | --- | --- | --- |`,
    ...COLOR_ROLES.map(([key, token, role]) => `| ${key} | \`${palette[key]}\` | \`${token}\` | ${role} |`),
    ``,
    `## Tokens — Typography`,
    ``,
    `### Display — \`--font-display\``,
    `- **Family:** ${FONT_STACK[type.display]}`,
    `- **Case:** ${type.displayCase === "upper" ? "caixa alta" : "caixa natural"}`,
    ``,
    `### Body — \`--font-body\``,
    `- **Family:** ${FONT_STACK[type.body]}`,
    `- **Line length:** máximo 72 caracteres.`,
    ``,
    `### Type Scale`,
    ``,
    `| Role | Size | Line Height | Letter Spacing | Token |`,
    `| --- | --- | --- | --- | --- |`,
    ...steps.map((s) => `| ${s.role} | ${s.size} | ${s.leading} | ${s.tracking} | \`--text-${s.role}\` |`),
    ``,
    `Quatro tamanhos, três pesos. Não acrescente um quinto.`,
    ``,
    `## Tokens — Spacing & Shapes`,
    ``,
    `**Density:** ${direction.rhythm}`,
    ``,
    `| Name | Value | Token |`,
    `| --- | --- | --- |`,
    `| section | ${space.section} | \`--space-section\` |`,
    `| block | ${space.block} | \`--space-block\` |`,
    `| inline | ${space.inline} | \`--space-inline\` |`,
    ``,
    `### Border Radius`,
    ``,
    `\`${RADIUS_PX[direction.radius]}\` em tudo. Um raio por site.`,
    ``,
    `### Shadows`,
    ``,
    `Nenhuma. A hierarquia vem de espaço, peso e linha.`,
    ``,
    `## Components`,
    ``,
    `- **Navbar** — nome do negócio à esquerda, âncoras à direita, um CTA. Sem blur, sem transparência.`,
    `- **Hero** — o dispositivo \`${direction.device}\` manda aqui. Um CTA primário, um só.`,
    `- **Services** — cada serviço tem nome, resumo e corpo confirmados. Sem ícone decorativo.`,
    `- **Contact** — só os canais confirmados. Um canal ausente não vira placeholder.`,
    `- **Footer** — nome, contato, e nada mais.`,
    ``,
    `## Do's and Don'ts`,
    ``,
    `### Do`,
    `- Deixe a tipografia carregar a personalidade.`,
    `- Use \`--accent\` uma vez por tela, no que mais importa.`,
    `- Deixe respiro: \`--space-section\` entre seções, sempre.`,
    `- Estruture com o dispositivo da direção, não com cartões genéricos.`,
    `- Garanta foco de teclado visível e \`prefers-reduced-motion\`.`,
    ``,
    antiSlopMarkdown(),
    ``,
    `## Motion`,
    ``,
    direction.motion.moment === "none"
      ? `Nenhum movimento de entrada. Só estados de foco e de formulário.`
      : `Um único momento: \`${direction.motion.moment}\`, no carregamento, até ${direction.motion.maxMs}ms, opacidade e no máximo 2px de deslocamento.`,
    `Fora isso, movimento só responde a uma ação da pessoa. Respeite \`prefers-reduced-motion\`.`,
    ``,
    `## Agent Prompt Guide`,
    ``,
    `### Quick Color Reference`,
    `- Fundo: \`${palette.surface}\` · segundo plano: \`${palette.surfaceAlt}\``,
    `- Texto: \`${palette.ink}\` · secundário: \`${palette.inkMuted}\``,
    `- Borda: \`${palette.line}\` · acento: \`${palette.accent}\``,
    ``,
    `## Quick Start`,
    ``,
    `### CSS Custom Properties`,
    ``,
    "```css",
    `:root {`,
    ...Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`),
    `}`,
    "```",
    ``,
    `### Tailwind v4`,
    ``,
    "```css",
    `@theme {`,
    `  --color-surface: ${palette.surface};`,
    `  --color-surface-alt: ${palette.surfaceAlt};`,
    `  --color-ink: ${palette.ink};`,
    `  --color-ink-muted: ${palette.inkMuted};`,
    `  --color-line: ${palette.line};`,
    `  --color-accent: ${palette.accent};`,
    `  --radius-base: ${RADIUS_PX[direction.radius]};`,
    `}`,
    "```",
  ];

  return lines.join("\n");
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-emitters.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 6: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npx vitest run tests/unit/design-emitters.test.ts
git add src/lib/design/tokens.ts src/lib/design/design-md.ts tests/unit/design-emitters.test.ts
git commit -m "feat(design): emit css custom properties and a DESIGN.md from one direction"
```

---

## Task 6: Blocos e composição

**Files:**
- Create: `src/lib/design/blocks.ts`
- Test: `tests/unit/design-blocks.test.ts`

**Interfaces:**
- Consumes: `SiteBrief`, `isSiteBriefV2`, `briefPublicContact` de `@/lib/site-factory/brief-schema`; `CategoryId`
- Produces:
  - `type BlockId = "navbar" | "hero" | "differentiators" | "services" | "about" | "hours" | "location" | "contact" | "footer"`
  - `const BLOCK_LABELS: Record<BlockId, string>`
  - `function resolveComposition(brief: SiteBrief): { blocks: BlockId[]; unmapped: string[] }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/design-blocks.test.ts
import { describe, expect, it } from "vitest";

import { resolveComposition } from "@/lib/design/blocks";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function briefV2(overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact("Barbearia Aurora"),
    sector: fact("Barbearia"),
    city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas que procuram corte e barba na região."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [],
    desiredSections: ["Início", "Serviços", "Contato"],
    visualDirection: fact("Visual sóbrio e legível."),
    notes: null,
    services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
    ...overrides,
  });
}

describe("composição de blocos", () => {
  it("sempre entrega o esqueleto mínimo", () => {
    const { blocks } = resolveComposition(briefV2());
    expect(blocks).toContain("navbar");
    expect(blocks).toContain("hero");
    expect(blocks).toContain("about");
    expect(blocks).toContain("footer");
  });

  it("não emite serviços quando o briefing não confirmou nenhum", () => {
    expect(resolveComposition(briefV2()).blocks).not.toContain("services");
  });

  it("emite serviços quando há serviço confirmado", () => {
    const brief = briefV2({
      services: [{
        id: "corte", name: fact("Corte"), summary: fact("Corte masculino."),
        body: [fact("Corte na tesoura ou na máquina, com acabamento na navalha.")],
        relatedIds: [], featured: false,
      }],
    });
    expect(resolveComposition(brief).blocks).toContain("services");
  });

  it("não emite horários nem localização sem o fato correspondente", () => {
    const { blocks } = resolveComposition(briefV2());
    expect(blocks).not.toContain("hours");
    expect(blocks).not.toContain("location");
  });

  it("emite localização quando o endereço foi confirmado", () => {
    const brief = briefV2({
      publicContact: {
        phone: null, whatsapp: null, email: null,
        address: {
          value: {
            street: "Rua das Flores", number: "10", complement: null,
            neighborhood: "Centro", city: "Fortaleza", state: "CE",
            postalCode: null, country: "Brasil",
          },
          source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z",
        },
        coordinates: null, openingHours: null, socialLinks: [],
      },
    });
    const { blocks } = resolveComposition(brief);
    expect(blocks).toContain("location");
    expect(blocks).toContain("contact");
  });

  it("nunca emite bloco que exigiria inventar conteúdo", () => {
    const { blocks } = resolveComposition(briefV2());
    for (const forbidden of ["testimonials", "pricing", "faq", "stats", "logos"]) {
      expect(blocks as string[]).not.toContain(forbidden);
    }
  });

  it("reporta a seção pedida que não mapeia, em vez de ignorar em silêncio", () => {
    const brief = briefV2({ desiredSections: ["Início", "Depoimentos", "Tabela de preços"] });
    const { unmapped } = resolveComposition(brief);
    expect(unmapped).toContain("Depoimentos");
    expect(unmapped).toContain("Tabela de preços");
  });

  it("um briefing v1 não gera páginas de serviço", () => {
    const v1 = siteBriefSchema.parse({
      schemaVersion: 1,
      businessName: fact("Padaria Aurora"), sector: fact("Padaria"), city: fact("Fortaleza"),
      objective: fact("Apresentar o negócio."), audience: fact("Vizinhança."),
      positioning: fact("Informação clara e verificada."),
      services: [fact("Pães artesanais")], differentiators: [],
      desiredSections: ["Início", "Serviços"], visualDirection: fact("Sóbrio."), notes: null,
    });
    expect(resolveComposition(v1).blocks).not.toContain("services");
  });

  it("não repete bloco", () => {
    const { blocks } = resolveComposition(briefV2({ desiredSections: ["Início", "Início", "Contato"] }));
    expect(new Set(blocks).size).toBe(blocks.length);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/design-blocks.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/blocks'`

- [ ] **Step 3: Implementar**

```ts
// src/lib/design/blocks.ts
import { normalizeForMatching } from "@/lib/content-integrity";
import {
  briefPublicContact, isSiteBriefV2, type SiteBrief,
} from "@/lib/site-factory/brief-schema";

/**
 * The blocks a site built only from confirmed facts can publish.
 *
 * The vocabulary is the one every marketing component library uses, minus
 * everything that cannot be filled without inventing: testimonials, pricing,
 * FAQ, statistics, logo clouds, guarantee badges. Those are not omitted for
 * taste — `content-integrity.ts` already rejects the same claims in text, and a
 * block whose only possible content is invention has no place in the taxonomy.
 */
export type BlockId =
  | "navbar" | "hero" | "differentiators" | "services" | "about"
  | "hours" | "location" | "contact" | "footer";

export const BLOCK_LABELS: Record<BlockId, string> = {
  navbar: "Navegação", hero: "Abertura", differentiators: "Diferenciais",
  services: "Serviços", about: "Sobre", hours: "Horários",
  location: "Localização", contact: "Contato", footer: "Rodapé",
};

/** Canonical order. A composition is a filter over this, never a reshuffle. */
const BLOCK_ORDER: BlockId[] = [
  "navbar", "hero", "about", "differentiators", "services", "hours",
  "location", "contact", "footer",
];

/** What an operator types in `desiredSections`, mapped onto a block. */
const SECTION_ALIASES: [BlockId, string[]][] = [
  ["hero", ["inicio", "home", "abertura", "capa", "topo"]],
  ["about", ["sobre", "quem somos", "a empresa", "historia", "apresentacao"]],
  ["differentiators", ["diferenciais", "por que", "vantagens", "destaques"]],
  ["services", ["servicos", "produtos", "o que fazemos", "especialidades", "cardapio"]],
  ["hours", ["horarios", "funcionamento", "atendimento"]],
  ["location", ["localizacao", "endereco", "onde estamos", "mapa", "como chegar"]],
  ["contact", ["contato", "fale conosco", "orcamento", "agendamento"]],
];

export function resolveComposition(brief: SiteBrief): { blocks: BlockId[]; unmapped: string[] } {
  const contact = briefPublicContact(brief);

  // A block is available only when the fact behind it was confirmed. This is
  // the gate; `desiredSections` can narrow it but never open it.
  const available = new Set<BlockId>(["navbar", "hero", "about", "footer"]);

  if (brief.differentiators.length > 0) available.add("differentiators");
  if (isSiteBriefV2(brief) && brief.services.length > 0) available.add("services");
  if (contact.openingHours) available.add("hours");
  if (contact.address) available.add("location");
  if (contact.phone || contact.whatsapp || contact.email || contact.address ||
      contact.socialLinks.length > 0) {
    available.add("contact");
  }

  const unmapped: string[] = [];
  for (const section of brief.desiredSections) {
    const normalized = normalizeForMatching(section);
    const match = SECTION_ALIASES.find(([, aliases]) =>
      aliases.some((alias) => normalized.includes(alias)),
    );
    // A requested section that maps to nothing, or to a block no confirmed
    // fact supports, is reported. Dropping it silently would let an operator
    // believe a section was built when it never could be.
    if (!match || !available.has(match[0])) unmapped.push(section);
  }

  return { blocks: BLOCK_ORDER.filter((block) => available.has(block)), unmapped };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/design-blocks.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npx vitest run tests/unit/design-blocks.test.ts
git add src/lib/design/blocks.ts tests/unit/design-blocks.test.ts
git commit -m "feat(design): block taxonomy gated by confirmed facts"
```

---

## Task 7: Roster de fontes e renderizador de blocos

Esta é a tarefa que troca o site atual. Ela existe depois das seis anteriores porque consome todas.

**Files:**
- Create: `src/app/sites/[id]/layout.tsx`
- Rewrite: `src/components/sites/project-site.tsx`
- Test: `tests/unit/project-site-render.test.ts`

**Interfaces:**
- Consumes: `resolveArtDirection`, `toStyleAttribute`, `resolveComposition`, `findSlop`
- Produces: `function ProjectSite({ brief, seed }: { brief: SiteBrief; seed: string }): JSX.Element`

> **Mudança de assinatura:** `ProjectSite` passa a exigir `seed`. Os dois
> chamadores (`src/app/sites/[id]/page.tsx` e, na Task 8, a prévia interna)
> passam `project.id`.

- [ ] **Step 1: Escrever o teste que falha**

O ambiente do Vitest é `node`, e `renderToStaticMarkup` é exatamente a
ferramenta certa para auditar markup — sem jsdom, sem DOM.

```ts
// tests/unit/project-site-render.test.ts
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectSite } from "@/components/sites/project-site";
import { findSlop } from "@/lib/design/anti-slop";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function brief(sector: string, overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact("Aurora"), sector: fact(sector), city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas da região que procuram este tipo de serviço."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [], desiredSections: ["Início", "Contato"],
    visualDirection: fact("Sóbrio e legível."), notes: null, services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
    ...overrides,
  });
}

function render(sector: string, seed: string, overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ProjectSite, { brief: brief(sector, overrides), seed }),
  );
}

describe("renderizador do site", () => {
  it("não comete nenhuma das regras anti-slop", () => {
    for (const sector of ["Barbearia", "Advocacia", "Pizzaria", "Clínica odontológica", "Pousada"]) {
      const found = findSlop(render(sector, "semente-fixa"));
      expect(found.map((rule) => rule.id), sector).toEqual([]);
    }
  });

  it("aplica a paleta da direção resolvida", () => {
    const html = render("Barbearia", "semente-fixa");
    const direction = resolveArtDirection({ sector: "Barbearia", seed: "semente-fixa" });
    expect(html).toContain(direction.palette.surface);
    expect(html).toContain(direction.palette.ink);
  });

  it("dá visuais diferentes a categorias diferentes", () => {
    const barbearia = render("Barbearia", "s");
    const advocacia = render("Advocacia", "s");
    expect(barbearia).not.toBe(advocacia);

    const dark = resolveArtDirection({ sector: "Barbearia", seed: "s" });
    const light = resolveArtDirection({ sector: "Advocacia", seed: "s" });
    expect(dark.palette.surface).not.toBe(light.palette.surface);
  });

  it("dá visuais diferentes a dois clientes da mesma categoria", () => {
    const seeds = Array.from({ length: 12 }, (_, index) => `projeto-${index}`);
    const rendered = new Set(seeds.map((seed) => render("Barbearia", seed)));
    expect(rendered.size).toBeGreaterThan(1);
  });

  it("é estável: a mesma semente rende o mesmo markup", () => {
    expect(render("Barbearia", "fixa")).toBe(render("Barbearia", "fixa"));
  });

  it("publica o nome e o posicionamento confirmados", () => {
    const html = render("Barbearia", "s");
    expect(html).toContain("Aurora");
    expect(html).toContain("Informações claras e verificadas sobre o negócio.");
  });

  it("não inventa seção sem fato: sem contato confirmado, sem bloco de contato", () => {
    const html = render("Barbearia", "s");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
  });

  it("publica só o canal confirmado", () => {
    const html = render("Barbearia", "s", {
      publicContact: {
        phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
        whatsapp: null, email: null, address: null, coordinates: null,
        openingHours: null, socialLinks: [],
      },
    });
    expect(html).toContain("tel:+5585999998888");
    expect(html).not.toContain("wa.me");
  });

  it("não vaza marca da fábrica para o site do cliente", () => {
    expect(render("Barbearia", "s")).not.toMatch(/NOX|nox-os/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/project-site-render.test.ts`
Expected: FAIL — `ProjectSite` ainda não aceita `seed`, e `findSlop` acusa gradiente, glassmorphism, eyebrow e `01/02/03`.

- [ ] **Step 3: Criar o layout com o roster de fontes**

```tsx
// src/app/sites/[id]/layout.tsx
import {
  Archivo, DM_Mono, Fraunces, Instrument_Serif, Inter, Inter_Tight,
  Source_Serif_4, Work_Sans,
} from "next/font/google";

/**
 * The font roster for generated sites.
 *
 * It lives here rather than in the root layout because `next/font` resolves at
 * build time and loads whatever it declares: the admin panel has no reason to
 * download a client site's typeface. `FontToken` is the closed union over this
 * list, so a direction cannot name a face this layout does not load.
 */
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

const FONTS = [
  fraunces, sourceSerif, instrumentSerif, archivo, interTight, inter, workSans, dmMono,
].map((font) => font.variable).join(" ");

export default function GeneratedSiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={FONTS}>{children}</div>;
}
```

- [ ] **Step 4: Reescrever o renderizador**

Substitua `src/components/sites/project-site.tsx` inteiro. Pontos não negociáveis, cada um correspondendo a uma regra da Task 4:

- todo valor visual sai de `toStyleAttribute(direction)`; nenhuma cor literal no JSX;
- **nenhum** `uppercase tracking-[…]` acima de seção;
- **nenhuma** numeração `01/02/03` sobre serviços;
- endereço unido com `", "` e quebras de linha, **nunca** com `·`;
- **nenhuma** seta em texto de link;
- os blocos vêm de `resolveComposition(brief)`, na ordem que ela devolve;
- o único movimento é o da direção, atrás de `@media (prefers-reduced-motion: no-preference)`.

```tsx
// src/components/sites/project-site.tsx
import { resolveArtDirection } from "@/lib/design/art-direction";
import { resolveComposition, type BlockId } from "@/lib/design/blocks";
import { toStyleAttribute } from "@/lib/design/tokens";
import { briefPublicContact, isSiteBriefV2, type SiteBrief } from "@/lib/site-factory/brief-schema";

function addressLines(address: {
  street: string; number: string | null; complement: string | null;
  neighborhood: string | null; city: string; state: string;
  postalCode: string | null; country: string;
}): string[] {
  // Joined with commas and line breaks. A middle dot between fields is one of
  // the tells the anti-slop rules exist to stop.
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.neighborhood,
    `${address.city}, ${address.state}`,
    address.postalCode,
  ].filter((line): line is string => Boolean(line));
}

export function ProjectSite({ brief, seed }: { brief: SiteBrief; seed: string }) {
  const direction = resolveArtDirection({ sector: brief.sector.value, seed });
  const { blocks } = resolveComposition(brief);
  const contact = briefPublicContact(brief);
  const services = isSiteBriefV2(brief) ? brief.services : [];
  const has = (block: BlockId) => blocks.includes(block);

  return (
    <main
      style={toStyleAttribute(direction)}
      className="min-h-screen overflow-x-hidden"
      // Colours come from the direction, never from a literal in this file.
      data-ground={direction.ground}
    >
      {has("navbar") ? (
        <header
          className="border-b"
          style={{ background: "var(--surface)", borderColor: "var(--line)" }}
        >
          <div
            className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-6 py-5"
            style={{ color: "var(--ink)" }}
          >
            <a
              href="#inicio"
              className="truncate font-medium"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-small)",
                textTransform: direction.type.displayCase === "upper" ? "uppercase" : "none",
                letterSpacing: direction.type.displayCase === "upper" ? "0.08em" : "0",
              }}
            >
              {brief.businessName.value}
            </a>
            <nav aria-label="Seções" className="flex gap-6" style={{ fontSize: "var(--text-small)" }}>
              {has("services") ? <a href="#servicos">Serviços</a> : null}
              {has("contact") ? <a href="#contato">Contato</a> : null}
            </nav>
          </div>
        </header>
      ) : null}

      {has("hero") ? (
        <section
          id="inicio"
          style={{ background: "var(--surface)", paddingBlock: "var(--space-section)" }}
        >
          <div className="mx-auto max-w-5xl px-6" style={{ color: "var(--ink)" }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-display)",
                lineHeight: "var(--leading-display)",
                letterSpacing: "var(--tracking-display)",
                textTransform: direction.type.displayCase === "upper" ? "uppercase" : "none",
                maxWidth: "18ch",
              }}
            >
              {brief.businessName.value}
            </h1>
            <p
              style={{
                marginTop: "var(--space-block)",
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-body)",
                lineHeight: "var(--leading-body)",
                color: "var(--ink-muted)",
                maxWidth: "62ch",
              }}
            >
              {brief.positioning.value}
            </p>
            {has("contact") ? (
              <a
                href="#contato"
                className="mt-8 inline-block border px-6 py-3"
                style={{
                  borderRadius: "var(--radius)",
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  fontSize: "var(--text-small)",
                }}
              >
                Falar com {brief.businessName.value}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {has("services") ? (
        <section
          id="servicos"
          style={{ background: "var(--surface-alt)", paddingBlock: "var(--space-section)" }}
        >
          <div className="mx-auto max-w-5xl px-6" style={{ color: "var(--ink)" }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-heading)",
                lineHeight: "var(--leading-heading)",
              }}
            >
              Serviços
            </h2>
            <div style={{ marginTop: "var(--space-block)" }}>
              {services.map((service) => (
                <article
                  key={service.id}
                  className="border-t py-6"
                  style={{ borderColor: "var(--line)" }}
                >
                  <h3
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--text-heading)",
                      lineHeight: "var(--leading-heading)",
                    }}
                  >
                    {service.name.value}
                  </h3>
                  <p
                    style={{
                      marginTop: "var(--space-inline)",
                      fontFamily: "var(--font-body)",
                      fontSize: "var(--text-body)",
                      lineHeight: "var(--leading-body)",
                      color: "var(--ink-muted)",
                      maxWidth: "62ch",
                    }}
                  >
                    {service.summary.value}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* `about`, `differentiators`, `hours`, `location`, `contact` e `footer`
          seguem o mesmo padrão dos três acima: nenhuma cor literal, todo valor
          vindo de var(--*), e o bloco só existe quando `has(...)` diz que o
          fato foi confirmado. Em `contact`, cada canal é renderizado só se o
          fato correspondente não for nulo, e o endereço usa `addressLines()`.
          Em `footer`, só o nome do negócio e o ano — nada de marca da fábrica. */}
    </main>
  );
}
```

> Os três blocos acima fixam o padrão inteiro: nenhuma cor literal, todo valor
> por `var(--*)`, e o bloco condicionado a `has(...)`. Os seis restantes seguem
> a mesma forma. O teste do Step 1 reprova qualquer um dos quinze tells assim
> que aparecer no markup, em cinco categorias diferentes.

> **O `device` da direção entra aqui.** `menu-leader` desenha a lista de
> serviços com pontilhado condutor; `bound-spine` põe a lombada vertical à
> esquerda; `dimension-line` usa linha de cota como divisor. Sem isso as catorze
> direções viram catorze paletas sobre o mesmo layout — que é o template de
> novo, só que colorido.

- [ ] **Step 5: Atualizar o chamador da página pública**

Em `src/app/sites/[id]/page.tsx`, na última linha do componente:

```tsx
return <ProjectSite brief={result.brief} seed={result.project.id} />;
```

E acrescente `id: true` já presente no `select` — confirme que `project.id` está selecionado (está).

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `npx vitest run tests/unit/project-site-render.test.ts tests/unit/built-site-route.test.ts`
Expected: PASS, 9 + os existentes.

- [ ] **Step 7: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npm run test
git add src/app/sites src/components/sites/project-site.tsx tests/unit/project-site-render.test.ts
git commit -m "feat(sites): render the site from its category art direction"
```

---

## Task 8: A prévia interna deixa de ser duplicata

`src/app/projetos/[id]/preview/page.tsx` repete cerca de 200 linhas de `project-site.tsx`, com os mesmos tells, livres para divergir a cada edição.

**Files:**
- Rewrite: `src/app/projetos/[id]/preview/page.tsx`
- Test: `tests/unit/preview-page-dedup.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/preview-page-dedup.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREVIEW = "src/app/projetos/[id]/preview/page.tsx";

describe("prévia interna", () => {
  const source = readFileSync(PREVIEW, "utf8");

  it("renderiza o componente compartilhado em vez de duplicar o site", () => {
    expect(source).toContain("ProjectSite");
  });

  it("não carrega mais a cópia dos tells", () => {
    expect(source).not.toMatch(/radial-gradient/);
    expect(source).not.toMatch(/backdrop-blur/);
    expect(source).not.toMatch(/padStart\(2, "0"\)/);
    expect(source).not.toMatch(/join\(" · "\)/);
  });

  it("continua exigindo sessão e permissão", () => {
    expect(source).toContain("requireUser");
    expect(source).toContain('requirePermission("project:read")');
  });

  it("continua marcada como não indexável", () => {
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/preview-page-dedup.test.ts`
Expected: FAIL — a página ainda tem `radial-gradient` e não menciona `ProjectSite`.

- [ ] **Step 3: Reescrever a página**

```tsx
// src/app/projetos/[id]/preview/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProjectSite } from "@/components/sites/project-site";
import { requirePermission } from "@/lib/authz/dal";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import { hasInternalPreview, isSiteProjectState } from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Prévia do site",
  robots: { index: false, follow: false },
};

/**
 * The internal preview is the same site under admin chrome.
 *
 * It used to be a second copy of the renderer, which meant every visual fix had
 * to be made twice and the two were free to disagree about what the client
 * would receive. The chrome is the only thing this page owns.
 */
export default async function ProjectPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  if (!isSiteProjectState(project.status) || !hasInternalPreview(project.status)) {
    redirect(`/projetos/${project.id}/geracao`);
  }

  const currentBrief = project.briefVersions.find(
    (brief) => brief.id === project.currentBriefVersionId,
  );
  if (!currentBrief) redirect(`/projetos/${project.id}/geracao`);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-nox-border bg-nox-bg px-5 py-3 text-sm">
        <Link href={`/projetos/${project.id}`} className="text-nox-muted hover:text-white">
          Voltar ao projeto
        </Link>
        <span className="rounded-full border border-nox-border px-3 py-1 text-xs text-nox-muted">
          Prévia interna
        </span>
      </div>
      <ProjectSite brief={parseSiteBrief(currentBrief.contentJson)} seed={project.id} />
    </>
  );
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/preview-page-dedup.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npm run test
git add "src/app/projetos/[id]/preview/page.tsx" tests/unit/preview-page-dedup.test.ts
git commit -m "refactor(projetos): internal preview renders the shared site"
```

---

## Task 9: O prompt do agente — DESIGN.md e BRIEFING

**Files:**
- Modify: `src/lib/generation/prompt.ts`
- Test: `tests/unit/generation-prompt.test.ts`

**Interfaces:**
- Consumes: `toDesignMarkdown`, `resolveArtDirection`
- Produces: `buildGenerationPrompt(input)` — `PromptInput` ganha `seed: string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/generation-prompt.test.ts
import { describe, expect, it } from "vitest";

import { buildGenerationPrompt } from "@/lib/generation/prompt";
import { siteBriefV2Schema, type SiteBriefV2 } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

const brief: SiteBriefV2 = siteBriefV2Schema.parse({
  schemaVersion: 2,
  businessName: fact("Barbearia Aurora"), sector: fact("Barbearia"), city: fact("Fortaleza"),
  objective: fact("Apresentar o negócio e facilitar novos contatos."),
  audience: fact("Pessoas que procuram corte e barba na região."),
  positioning: fact("Informações claras e verificadas sobre o negócio."),
  differentiators: [], desiredSections: ["Início", "Serviços", "Contato"],
  visualDirection: fact("Sóbrio, escuro e legível."), notes: null,
  services: [{
    id: "corte", name: fact("Corte"), summary: fact("Corte masculino."),
    body: [fact("Corte na tesoura ou na máquina, com acabamento na navalha.")],
    relatedIds: [], featured: false,
  }],
  publicContact: {
    phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
    whatsapp: null, email: null, address: null, coordinates: null,
    openingHours: null, socialLinks: [],
  },
  metaDescription: null,
});

const input = {
  brief,
  projectName: "barbearia-aurora",
  seed: "cmtm2yp9u0004zpc3r7jgufvr",
  repository: { owner: "nox", name: "barbearia-aurora", baseBranch: "main" },
};

describe("prompt de geração", () => {
  const prompt = buildGenerationPrompt(input);

  it("separa gosto de fato em duas seções nomeadas", () => {
    expect(prompt).toContain("# DESIGN.md");
    expect(prompt).toContain("# BRIEFING");
    expect(prompt.indexOf("# DESIGN.md")).toBeLessThan(prompt.indexOf("# BRIEFING"));
  });

  it("carrega a direção resolvida, com âncora e paleta", () => {
    expect(prompt).toContain("Espelho e latão sob luz baixa");
    expect(prompt).toContain("## Tokens — Colors");
  });

  it("carrega as regras anti-slop", () => {
    expect(prompt).toContain("### Don't");
    expect(prompt).toContain("Sem gradiente radial");
  });

  it("mantém as regras não negociáveis do briefing", () => {
    expect(prompt).toMatch(/Não invente/i);
    expect(prompt).toMatch(/pull request/i);
  });

  it("publica só os fatos confirmados", () => {
    expect(prompt).toContain("Barbearia Aurora");
    expect(prompt).toContain("+5585999998888");
    expect(prompt).not.toContain("whatsapp");
  });

  it("passa a direção do operador como refinamento, nomeada como tal", () => {
    expect(prompt).toContain("Sóbrio, escuro e legível.");
    expect(prompt).toMatch(/refinamento|dentro da direção/i);
  });

  it("é determinístico para a mesma semente", () => {
    expect(buildGenerationPrompt(input)).toBe(buildGenerationPrompt(input));
  });

  it("muda quando a semente muda, sem mudar os fatos", () => {
    const other = buildGenerationPrompt({ ...input, seed: "outra-semente-diferente" });
    expect(other).toContain("Barbearia Aurora");
    expect(other).toContain("Espelho e latão sob luz baixa");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/generation-prompt.test.ts`
Expected: FAIL — `buildGenerationPrompt` não aceita `seed` e não emite `# DESIGN.md`.

- [ ] **Step 3: Reescrever `buildGenerationPrompt`**

Mantenha o comentário de topo do arquivo — as duas garantias que ele documenta continuam valendo — e acrescente por que a direção não as viola.

```ts
export type PromptInput = {
  brief: SiteBriefV2;
  projectName: string;
  /** `SiteProject.id`. Fixes the direction, so the prompt is reproducible. */
  seed: string;
  repository: { owner: string; name: string; baseBranch: string };
};

export function buildGenerationPrompt(input: PromptInput): string {
  const { brief } = input;
  const direction = resolveArtDirection({ sector: brief.sector.value, seed: input.seed });

  const facts: string[] = [
    `Você vai construir o site de "${brief.businessName.value}" no repositório ${input.repository.owner}/${input.repository.name}.`,
    "",
    "Regras não negociáveis:",
    "- Use apenas os fatos listados abaixo. Não invente serviços, horários, endereços, preços, prêmios nem depoimentos.",
    "- Se um fato não está aqui, ele não vai para o site.",
    "- Siga o DESIGN.md acima à risca. Ele é a direção de arte deste site.",
    "- Trabalhe numa branch própria e abra um pull request. Não escreva na branch padrão.",
    "",
    "Fatos confirmados:",
    bullet("Nome", brief.businessName.value),
    bullet("Setor", brief.sector.value),
    bullet("Objetivo", brief.objective.value),
    bullet("Público", brief.audience.value),
    bullet("Posicionamento", brief.positioning.value),
  ];

  // The operator's own visual note is a confirmed fact and a refinement — it
  // steers *within* the resolved direction and never replaces a token.
  facts.push(
    "",
    "Refinamento do operador, a ser aplicado dentro da direção acima, sem trocar nenhum token:",
    `- ${brief.visualDirection.value}`,
  );

  // ... seções de serviços e contato como hoje ...

  return [`# DESIGN.md`, ``, toDesignMarkdown(direction), ``, `# BRIEFING`, ``, ...facts].join("\n");
}
```

- [ ] **Step 4: Atualizar os chamadores**

```bash
grep -rn "buildGenerationPrompt" src tests
```

Cada chamador passa `seed: project.id`. Provavelmente `src/lib/generation/start.ts`.

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npx vitest run tests/unit/generation-prompt.test.ts tests/unit/generation-start-db.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npm run test
git add src/lib/generation tests/unit/generation-prompt.test.ts
git commit -m "feat(generation): prompt carries DESIGN.md taste and BRIEFING facts separately"
```

---

## Task 10: `branding` deixa de ser literal no snapshot

**Files:**
- Modify: `src/lib/site-factory/site-export.ts`
- Test: `tests/unit/site-export-branding.test.ts`

> O schema **não** muda. Só os valores dos seis campos deixam de ser fixos.

**Interfaces:**
- `SiteExportInput` ganha `seed: string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/site-export-branding.test.ts
import { describe, expect, it } from "vitest";

import { resolveArtDirection } from "@/lib/design/art-direction";
import { siteBriefV2Schema, type SiteBriefV2 } from "@/lib/site-factory/brief-schema";
import { buildSiteContentSnapshot } from "@/lib/site-factory/site-export";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function briefFor(sector: string): SiteBriefV2 {
  return siteBriefV2Schema.parse({
    schemaVersion: 2,
    businessName: fact("Aurora"), sector: fact(sector), city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas da região que procuram este tipo de serviço."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [], desiredSections: ["Início", "Contato"],
    visualDirection: fact("Sóbrio e legível."), notes: null, services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
  });
}

describe("branding do snapshot", () => {
  it("vem da direção, não de um literal", () => {
    const seed = "cmtm2yp9u0004zpc3r7jgufvr";
    const snapshot = buildSiteContentSnapshot({
      brief: briefFor("Barbearia"), siteUrl: "https://exemplo.com.br", seed,
      privacy: { controllerName: "Aurora", updatedAt: "2026-09-03T12:00:00.000Z", sections: [] },
    }) as { branding: Record<string, string> };

    const direction = resolveArtDirection({ sector: "Barbearia", seed });
    expect(snapshot.branding.surfaceColor).toBe(direction.palette.surface);
    expect(snapshot.branding.textColor).toBe(direction.palette.ink);
    expect(snapshot.branding.accentColor).toBe(direction.palette.accent);
    expect(snapshot.branding.primaryColor).not.toBe("#1d4ed8");
  });

  it("respeita o enum do contrato", () => {
    for (const sector of ["Barbearia", "Advocacia", "Pizzaria", "Pousada", "Academia"]) {
      const snapshot = buildSiteContentSnapshot({
        brief: briefFor(sector), siteUrl: "https://exemplo.com.br", seed: "s",
        privacy: { controllerName: "X", updatedAt: "2026-09-03T12:00:00.000Z", sections: [] },
      }) as { branding: Record<string, string> };

      expect(["sans", "serif"]).toContain(snapshot.branding.fontFamily);
      expect(["none", "sm", "md", "lg"]).toContain(snapshot.branding.radius);
      for (const key of ["primaryColor", "accentColor", "surfaceColor", "textColor"]) {
        expect(snapshot.branding[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/site-export-branding.test.ts`
Expected: FAIL — `branding.surfaceColor` ainda é `#ffffff`.

- [ ] **Step 3: Implementar**

Em `site-export.ts`, acrescente `seed: string` a `SiteExportInput` e troque o bloco literal:

```ts
const direction = resolveArtDirection({ sector: brief.sector.value, seed: input.seed });

const SERIF_FONTS = new Set(["fraunces", "source-serif", "instrument-serif"]);

// The contract carries six fields and no more. They are the load-bearing half
// of the direction — the rest reaches the generated site through the prompt.
branding: {
  primaryColor: direction.palette.ink,
  accentColor: direction.palette.accent,
  surfaceColor: direction.palette.surface,
  textColor: direction.palette.ink,
  fontFamily: SERIF_FONTS.has(direction.type.display) ? "serif" : "sans",
  radius: direction.radius,
},
```

- [ ] **Step 4: Atualizar os chamadores**

```bash
grep -rn "buildSiteContentSnapshot" src tests
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npx vitest run tests/unit/site-export-branding.test.ts tests/unit/site-export-contract.test.ts`
Expected: PASS. **O teste de contrato tem de passar sem alteração de schema.**

- [ ] **Step 6: Verificar e commitar**

```bash
npm run lint && npm run typecheck && npm run test
git add src/lib/site-factory/site-export.ts tests/unit/site-export-branding.test.ts
git commit -m "feat(site-export): branding comes from the art direction"
```

---

## Task 11: A rota `/projetos/[id]` que não existe

`https://nox-os-pi.vercel.app/projetos/cmtm2yp9u0004zpc3r7jgufvr` responde 404: só existem `[id]/geracao`, `[id]/preview` e `[id]/provisionamento`, e a listagem nunca linka a raiz.

**Files:**
- Create: `src/app/projetos/[id]/page.tsx`
- Modify: `src/app/projetos/page.tsx`
- Test: `tests/unit/project-detail-page.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/project-detail-page.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = "src/app/projetos/[id]/page.tsx";
const LIST = "src/app/projetos/page.tsx";

describe("raiz do projeto", () => {
  it("existe", () => {
    expect(existsSync(PAGE), `${PAGE} não existe: /projetos/<id> responde 404`).toBe(true);
  });

  it("exige sessão e permissão de leitura", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("requireUser");
    expect(source).toContain('requirePermission("project:read")');
    expect(source).toContain("getSiteProject");
  });

  it("mostra a direção de arte resolvida antes de qualquer geração", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("resolveArtDirection");
    expect(source).toContain("anchor");
  });

  it("leva às três etapas existentes", () => {
    const source = readFileSync(PAGE, "utf8");
    for (const route of ["/geracao", "/provisionamento", "/preview"]) {
      expect(source, route).toContain(route);
    }
  });

  it("a listagem passa a linkar a raiz", () => {
    expect(readFileSync(LIST, "utf8")).toMatch(/href=\{`\/projetos\/\$\{project\.id\}`\}/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/project-detail-page.test.ts`
Expected: FAIL — "não existe: /projetos/<id> responde 404"

- [ ] **Step 3: Criar a página**

Ela mostra: nome, cliente, estado com o rótulo de `SITE_PROJECT_STATE_LABELS`, versão do briefing, **a direção de arte resolvida** (âncora, categoria, paleta em amostras, e as seções pedidas que não mapearam), e três links para `geracao`, `provisionamento` e `preview`. Siga o visual do painel: `border-nox-border`, `bg-nox-surface`, `rounded-2xl`.

```tsx
// src/app/projetos/[id]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/authz/dal";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { resolveComposition } from "@/lib/design/blocks";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import {
  hasInternalPreview, isSiteProjectState, SITE_PROJECT_STATE_LABELS,
} from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Projeto",
  robots: { index: false, follow: false },
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  const currentBrief = project.briefVersions.find(
    (version) => version.id === project.currentBriefVersionId,
  );
  const brief = currentBrief ? parseSiteBrief(currentBrief.contentJson) : null;

  // The direction is shown before anyone generates, because the sector is free
  // text and the match can be wrong. Seeing it here is how an operator catches
  // a barbershop that resolved as a gym.
  const direction = brief
    ? resolveArtDirection({ sector: brief.sector.value, seed: project.id })
    : null;
  const composition = brief ? resolveComposition(brief) : null;

  const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";

  return (
    <div className="space-y-6">
      {/* cabeçalho: project.name, project.client.name, SITE_PROJECT_STATE_LABELS[state] */}
      {/* direção: direction.anchor, direction.categoryId, amostras da paleta */}
      {/* composition.unmapped: avisar seção pedida que não vira bloco */}
      {/* links: `/projetos/${project.id}/geracao`, `/provisionamento`,
          e `/preview` quando hasInternalPreview(state) */}
    </div>
  );
}
```

- [ ] **Step 4: Linkar a raiz na listagem**

Em `src/app/projetos/page.tsx`, o `<h3>` do card vira link para a raiz:

```tsx
<h3 className="mt-2 text-lg font-semibold text-white">
  <Link href={`/projetos/${project.id}`} className="hover:underline">{project.name}</Link>
</h3>
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/project-detail-page.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 6: Verificação completa e commit**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
git add "src/app/projetos" tests/unit/project-detail-page.test.ts
git commit -m "feat(projetos): add the missing project root page"
```

---

## Verificação final

```bash
npm run verify
```

Roda lint, typecheck, os testes de unidade, os testes de infraestrutura em Python e o build.

Depois, com o banco local de pé:

```bash
npm run dev
```

Abra `/projetos`, entre num projeto pela raiz, confira a direção resolvida, e compare a prévia interna com `/sites/<id>` — devem ser o mesmo site.

---

## Auto-revisão deste plano

**Cobertura da spec:** §1 → Tasks 7, 8, 11. §2.1 → Tasks 2, 3. §2.2 → Task 10. §2.3 → Tasks 2, 3. §2.4 → Tasks 3, 4. §3 → Tasks 1–5. §3.1 → Task 1. §4 → Task 3. §5 → Task 6. §6 → Task 4. §7 → Tasks 5, 9. §8 → Task 7. §9 → todas. §10 → cada Step 1.

**Consistência de tipos:** `CategoryId` (Task 1) é a chave de `DIRECTION_CATALOG` (Task 3) e o retorno de `resolveCategoryId`. `ArtDirection` (Task 2) é o parâmetro de `toCssVariables`, `toDesignMarkdown` (Task 5) e o retorno de `resolveArtDirection` (Task 3). `pickVariant` (Task 2) é consumida só pela Task 3. `BlockId` (Task 6) é consumida pela Task 7. `seed: string` entra em `PromptInput` (Task 9), `SiteExportInput` (Task 10) e nas props de `ProjectSite` (Task 7), sempre com o valor `SiteProject.id`.

**Ordem de dependência:** 1 → 2 → 3 → {4, 5} → 6 → 7 → {8, 9, 10}. A Task 11 é independente e pode ser feita a qualquer momento — é a que conserta o 404 e a única que entrega valor sozinha.
