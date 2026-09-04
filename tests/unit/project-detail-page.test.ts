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
    // A regression that swapped or dropped the seed would still show *a*
    // direction, just not the one the client actually receives.
    expect(source).toContain("seed: project.id");
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

  it("abre com a ação principal do estado atual", () => {
    const source = readFileSync(PAGE, "utf8");
    // The operator arrives here from the wizard and has to see what to do
    // next, not a report about art direction.
    expect(source).toContain("GenerateSiteButton");
    expect(source).toContain(
      "Gera o site a partir das informações confirmadas. Leva alguns segundos.",
    );
    // The button's own label, where it is written once.
    expect(
      readFileSync("src/components/projetos/generate-site-button.tsx", "utf8"),
    ).toContain('label="Gerar site"');
    // The action is offered only to someone the state machine would obey.
    expect(source).toContain('actor.permissions.includes("project:write")');
    // And it comes before the art-direction panel.
    expect(source.indexOf("GenerateSiteButton")).toBeLessThan(
      source.indexOf("Direção de arte resolvida"),
    );
  });

  it("leva ao site gerado e à prévia interna", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("href={`/sites/${project.id}`}");
    expect(source).toContain("Ver site");
    expect(source).toContain("Prévia interna");
  });

  it("não retipa o nome do estado", () => {
    // Labels live in the state machine. A page that spells one out is a page
    // that keeps showing the old wording after the machine is renamed.
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("SITE_PROJECT_STATE_LABELS[state]");
    expect(source).not.toContain("Briefing pronto");
    expect(source).not.toContain("Prévia pronta");
  });

  it("trata a construção do repositório como etapa opcional", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("Construção do repositório (opcional)");
  });
});

describe("saída do assistente", () => {
  it("leva o operador à raiz do projeto, onde está a ação", () => {
    const wizard = readFileSync("src/components/projetos/novo-projeto-wizard.tsx", "utf8");
    expect(wizard).toContain("`/projetos/${projectId}`");
    expect(wizard).not.toContain("`/projetos/${projectId}/geracao`");
  });
});
