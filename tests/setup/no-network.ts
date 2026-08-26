/**
 * No test reaches the internet.
 *
 * A test that passes by calling a real provider proves nothing: it is slow,
 * flaky, costs money, and stops proving anything the moment the network is
 * unavailable. Every outbound call must go through a fake, a recorded fixture,
 * or an explicit stub installed by the test itself — a stub simply replaces this
 * one, which is the intended escape hatch.
 */
const blocked = (target: string): never => {
  throw new Error(
    `Chamada de rede bloqueada no teste: ${target}. Use o modo FALSO, uma fixture de SANDBOX, ou instale um stub explícito.`,
  );
};

// Async on purpose: the real `fetch` returns a promise that rejects, and code
// under test catches it that way. Throwing synchronously would fail through a
// different path than the one production takes.
globalThis.fetch = (async (input: unknown) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : ((input as { url?: string })?.url ?? String(input));
  return blocked(target);
}) as typeof fetch;
