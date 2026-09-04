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
