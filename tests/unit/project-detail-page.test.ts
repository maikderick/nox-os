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
