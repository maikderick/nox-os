import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREVIEW = "src/app/projetos/[id]/preview/page.tsx";
const SITES_LAYOUT = "src/app/sites/[id]/layout.tsx";
const SITES_PAGE = "src/app/sites/[id]/page.tsx";

describe("prévia interna", () => {
  const source = readFileSync(PREVIEW, "utf8");

  it("renderiza o componente compartilhado em vez de duplicar o site", () => {
    expect(source).toContain("<ProjectSite");
    expect(source).toContain("<SiteFonts");
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

  it("depende do briefing, não do estado do projeto", () => {
    // The renderer is a pure function of the confirmed brief, so the team can
    // look at what it is about to release *before* releasing it. Gating this
    // page on `PREVIA_PRONTA` made the internal review impossible until after
    // the public link was already open.
    expect(source).not.toContain("hasInternalPreview");
    expect(source).toContain("currentBriefVersionId");
    expect(source).toMatch(/if \(!currentBrief\) redirect/);
  });
});

describe("site público", () => {
  const source = readFileSync(SITES_PAGE, "utf8");

  it("continua atrás do estado do projeto", () => {
    // This is the link the release actually opens, and it needs no session —
    // so the status, not the brief, is what may unlock it.
    expect(source).toContain("hasInternalPreview");
  });
});

describe("layout do site público", () => {
  const source = readFileSync(SITES_LAYOUT, "utf8");

  it("delega o roster de fontes ao componente compartilhado", () => {
    expect(source).not.toContain("next/font/google");
    expect(source).toContain("<SiteFonts");
  });
});
