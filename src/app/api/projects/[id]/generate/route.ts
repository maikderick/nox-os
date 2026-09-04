import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import { isValidIdempotencyKey, requestGeneration } from "@/lib/generation/request";
import { GenerationRefusal } from "@/lib/generation/reasons";
import { withGenerationErrors } from "@/lib/generation/route-errors";

type Context = { params: Promise<{ id: string }> };

/**
 * Ask for a generation.
 *
 * The header is validated here, before anything is written, because a `400` for
 * a malformed key has to be a refusal that left no trace: a key that reached the
 * reservation table would be a key the caller could never reuse after fixing
 * their client.
 *
 * The permission is checked inside `requestGeneration`, on the actor, for the
 * same reason in the other direction — an unauthorised caller must not be able
 * to burn a valid key.
 */
export async function POST(request: Request, context: Context) {
  return withGenerationErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;

    const key = request.headers.get("idempotency-key");
    if (!isValidIdempotencyKey(key)) {
      throw new GenerationRefusal("CHAVE_DE_REQUISICAO_INVALIDA");
    }

    const result = await requestGeneration({
      actor,
      siteProjectId: id,
      idempotencyKey: key,
    });

    // `200` rather than `201` on a repeat: the run was not created by this
    // call, and saying it was would make a retry indistinguishable from a
    // second generation on the wire.
    return NextResponse.json(result, { status: result.executed ? 201 : 200 });
  });
}
