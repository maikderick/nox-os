// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerationControls } from "@/components/projetos/generation-controls";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("controles de geração", () => {
  it("prepara as dependências na ordem e só então solicita a geração", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        status: url.endsWith("/generate") ? 201 : 200,
        json: async () => (url.endsWith("/api/jobs/run") ? { claimed: 1 } : {}),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(GenerationControls, {
        projectId: "project-1",
        canGenerate: true,
        canPrepare: true,
        needsProvisioning: true,
        canRunQueue: true,
        isProcessing: false,
        publicHref: null,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Preparar e gerar site" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/projects/project-1/provision/repository",
      "/api/projects/project-1/provision/content",
      "/api/projects/project-1/provision/hosting",
      "/api/projects/project-1/generate",
      "/api/jobs/run",
    ]);
    expect(await screen.findByText(/atualizada automaticamente/i)).toBeTruthy();
  });

  it("expõe a prévia pronta como uma ação direta", () => {
    render(
      React.createElement(GenerationControls, {
        projectId: "project-1",
        canGenerate: true,
        canPrepare: true,
        needsProvisioning: false,
        canRunQueue: true,
        isProcessing: false,
        publicHref: "/sites/project-1",
      }),
    );

    expect(screen.getByRole("link", { name: /abrir site do cliente/i }).getAttribute("href")).toBe(
      "/sites/project-1",
    );
    expect(screen.getByRole("button", { name: /copiar link/i })).toBeTruthy();
  });
});
