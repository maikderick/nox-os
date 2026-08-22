import { prisma } from "./db";

export const DEMO_AI_REQUEST_ACTION = "demo_landing.ai_requested";
export const DEMO_AI_SUGGESTION_ACTION = "demo_landing.ai_suggested";

/**
 * Usage is counted from the audit trail instead of memory: serverless instances
 * are not shared, so an in-process counter would not limit anything on Vercel.
 */
export async function countRecentDemoAiRequests(params: {
  userId: string;
  windowMs?: number;
  now?: Date;
}): Promise<number> {
  const windowMs = params.windowMs ?? 60 * 60 * 1_000;
  const now = params.now ?? new Date();

  return prisma.auditLog.count({
    where: {
      userId: params.userId,
      action: DEMO_AI_REQUEST_ACTION,
      createdAt: { gte: new Date(now.getTime() - windowMs) },
    },
  });
}
