import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { authorized } from "@/lib/authz/route";
import {
  IntegrationModeNotAvailableError,
  listIntegrations,
  setIntegrationMode,
} from "@/lib/integrations/settings-service";
import { INTEGRATION_MODES, INTEGRATION_PROVIDERS } from "@/lib/integrations/modes";

const updateSchema = z
  .object({
    provider: z.enum(INTEGRATION_PROVIDERS),
    mode: z.enum(INTEGRATION_MODES),
  })
  .strict();

export const GET = authorized(async () => {
  const actor = await requirePermission("org:read");
  return NextResponse.json({ integrations: await listIntegrations(actor) });
});

export const PATCH = authorized(async (request: Request) => {
  const actor = await requirePermission("integration:manage");
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const integration = await setIntegrationMode({
      actor,
      provider: body.data.provider,
      mode: body.data.mode,
    });
    return NextResponse.json({ integration });
  } catch (error) {
    // Asking for LIVE is a well-formed request for something this phase does
    // not offer — a conflict with the current state, not a malformed payload.
    if (error instanceof IntegrationModeNotAvailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
});
