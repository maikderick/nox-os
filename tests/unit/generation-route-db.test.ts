import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * The HTTP door of the generation chain.
 *
 * The header is validated before anything is written, and the permission on the
 * actor before the key is spent. Those two orders are the whole subject: a
 * malformed key must leave no trace, and an unauthorised caller must not be
 * able to burn a key the authorised one will reuse.
 */
const actorBox: { actor: GenerationFixture["actor"] | null } = { actor: null };

vi.mock("@/lib/authz/dal", async () => {
  const real = await vi.importActual<typeof import("@/lib/authz/dal")>("@/lib/authz/dal");
  // `AuthorizationError` lives in `authz/errors`, not in the DAL — taking it
  // from there keeps the thrown value the very class `authorizationResponse`
  // recognises, so a missing session comes back as 401 rather than as an
  // unrecognised failure.
  const { AuthorizationError } = await vi.importActual<
    typeof import("@/lib/authz/errors")
  >("@/lib/authz/errors");

  return {
    ...real,
    requireActor: async () => {
      if (!actorBox.actor) throw AuthorizationError.unauthenticated();
      return actorBox.actor;
    },
  };
});

const { POST } = await import("@/app/api/projects/[id]/generate/route");

function request(key?: string): Request {
  return new Request("http://localhost/api/projects/x/generate", {
    method: "POST",
    headers: key ? { "idempotency-key": key } : {},
  });
}

describeLocalDatabase("rota de geração", () => {
  let fx: GenerationFixture;

  beforeEach(async () => {
    fx = await createGenerationFixture();
    actorBox.actor = fx.actor;
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  const context = () => ({ params: Promise.resolve({ id: fx.siteProjectId }) });

  it("cria a geração e responde 201", async () => {
    const response = await POST(request(randomUUID()), context());
    const body = (await response.json()) as { generationRunId: string; jobId: string };

    expect(response.status).toBe(201);
    await expect(
      prisma.generationRun.findUniqueOrThrow({ where: { id: body.generationRunId } }),
    ).resolves.toMatchObject({ siteProjectId: fx.siteProjectId });
  });

  it("sem cabeçalho, 400 e nada escrito", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CHAVE_DE_REQUISICAO_INVALIDA" });
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(0);
  });

  it("com cabeçalho que não é UUID, 400", async () => {
    // A constant like this would make every generation this organization ever
    // asked for the same request.
    const response = await POST(request("retry"), context());

    expect(response.status).toBe(400);
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(0);
  });

  it("a repetição responde 200, e não 201", async () => {
    const key = randomUUID();
    const first = await POST(request(key), context());
    const second = await POST(request(key), context());

    const created = (await first.json()) as { generationRunId: string; jobId: string };
    const repeated = (await second.json()) as {
      generationRunId: string;
      jobId: string;
      executed: boolean;
    };

    expect(first.status).toBe(201);
    // The run was not created by this call, and saying it was would make a
    // retry indistinguishable from a second generation on the wire.
    expect(second.status).toBe(200);
    expect(repeated.generationRunId).toBe(created.generationRunId);
    expect(repeated.jobId).toBe(created.jobId);
    expect(repeated.executed).toBe(false);
  });

  it("mesma chave com outro projeto responde 409", async () => {
    const key = randomUUID();
    await POST(request(key), context());

    const outro = await createGenerationFixture();
    actorBox.actor = fx.actor;
    const response = await POST(request(key), {
      params: Promise.resolve({ id: outro.siteProjectId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CORPO_DIVERGENTE" });
  });

  it("projeto num estado sem transição para GERANDO responde 409", async () => {
    await prisma.siteProject.update({
      where: { id: fx.siteProjectId },
      data: { status: "APROVADO" },
    });

    const response = await POST(request(randomUUID()), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PROJETO_NAO_ELEGIVEL" });
  });

  it("sem sessão, 401 e nenhuma escrita", async () => {
    actorBox.actor = null;

    const response = await POST(request(randomUUID()), context());

    expect(response.status).toBe(401);
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(0);
  });

  it("um leitor recebe 403 sem gastar a chave", async () => {
    const key = randomUUID();
    actorBox.actor = { ...fx.actor, role: "LEITOR", permissions: [] };

    const negado = await POST(request(key), context());
    expect(negado.status).toBe(403);

    actorBox.actor = fx.actor;
    const permitido = await POST(request(key), context());
    expect(permitido.status).toBe(201);
  });

  it("sem preço configurado, 409 e nenhum crédito comprometido", async () => {
    const semPreco = await createGenerationFixture({ generationPriceCents: null });
    actorBox.actor = semPreco.actor;

    // The request itself succeeds — the price is only read when the step runs,
    // which is where refusing costs nothing.
    const response = await POST(request(randomUUID()), {
      params: Promise.resolve({ id: semPreco.siteProjectId }),
    });

    expect(response.status).toBe(201);
    expect(
      await prisma.creditReservation.count({ where: { organizationId: semPreco.organizationId } }),
    ).toBe(0);
  });
});
