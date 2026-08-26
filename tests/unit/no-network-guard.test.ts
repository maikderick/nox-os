import { describe, expect, it } from "vitest";

/**
 * The guard that guards the guard.
 *
 * `tests/setup/no-network.ts` replaces `fetch` for every suite, so no test can
 * pass by reaching the internet. Without this file, removing that line from
 * `vitest.config.ts` would go unnoticed: every test would keep passing, and the
 * ones that mattered would quietly start depending on a provider being up.
 */
describe("the network guard", () => {
  it("is installed for every suite", async () => {
    await expect(fetch("https://api.github.com/user")).rejects.toThrow(
      /Chamada de rede bloqueada no teste/,
    );
  });

  it("names what was attempted, so a leak is easy to find", async () => {
    await expect(fetch("https://api.vercel.com/v9/projects")).rejects.toThrow(
      /api\.vercel\.com/,
    );
  });

  it("blocks a Request object as well as a string", async () => {
    await expect(
      fetch(new Request("https://api.anthropic.com/v1/messages", { method: "POST" })),
    ).rejects.toThrow(/api\.anthropic\.com/);
  });

  it("lets a test install its own stub, which is the intended escape hatch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ok")) as typeof fetch;
    try {
      expect(await (await fetch("https://qualquer.coisa")).text()).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
