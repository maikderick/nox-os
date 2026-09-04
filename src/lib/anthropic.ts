import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  buildDemoAiJsonSchema,
  buildDemoAiUserPrompt,
  DEMO_AI_SYSTEM_PROMPT,
  mergeDemoAiDraft,
  validateDemoAiDraft,
  type DemoAiFacts,
  type DemoAiMergeResult,
} from "./demo-landing-ai";
import type { DemoLandingContent } from "./demo-landing-schema";

export type DemoAiErrorCode =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "refused"
  | "invalid_response"
  | "upstream";

/** Errors carry a stable code; the message is already safe to show to the user. */
export class DemoAiError extends Error {
  readonly code: DemoAiErrorCode;

  constructor(code: DemoAiErrorCode, message?: string) {
    super(message ?? DEMO_AI_ERROR_MESSAGES[code]);
    this.name = "DemoAiError";
    this.code = code;
  }
}

export const DEMO_AI_ERROR_MESSAGES: Record<DemoAiErrorCode, string> = {
  not_configured:
    "A melhoria com Claude não está configurada. Defina ANTHROPIC_API_KEY nas variáveis de ambiente da Vercel. O gerador automático gratuito continua disponível.",
  timeout:
    "O Claude demorou demais para responder. A demonstração não foi alterada — tente novamente em instantes.",
  rate_limited:
    "Limite de uso da melhoria com Claude atingido. Aguarde alguns minutos e tente novamente. O gerador automático gratuito continua disponível.",
  unauthorized:
    "A chave da API da Anthropic foi recusada. Revise ANTHROPIC_API_KEY nas variáveis de ambiente da Vercel.",
  refused:
    "O Claude não pôde processar este conteúdo. A demonstração não foi alterada.",
  invalid_response:
    "A resposta do Claude não passou na validação de conteúdo. Nada foi alterado na demonstração — use o conteúdo automático ou tente novamente.",
  upstream:
    "A API da Anthropic está indisponível no momento. A demonstração não foi alterada e o gerador automático gratuito continua funcionando.",
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 8_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_HOURLY_LIMIT = 20;

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export type DemoAiConfig = {
  configured: boolean;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  hourlyLimit: number;
};

/**
 * Reads the integration settings from the environment. The key itself is never
 * returned — only whether it is present.
 */
export function getDemoAiConfig(): DemoAiConfig {
  return {
    configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    maxTokens: positiveInt(process.env.ANTHROPIC_MAX_TOKENS, DEFAULT_MAX_TOKENS, 32_000),
    timeoutMs: positiveInt(process.env.ANTHROPIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 120_000),
    hourlyLimit: positiveInt(process.env.DEMO_AI_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT, 500),
  };
}

export type DemoAiCallParams = {
  system: string;
  prompt: string;
};

export type DemoAiCall = (params: DemoAiCallParams) => Promise<unknown>;

function assertServerSide() {
  if (typeof window !== "undefined") {
    throw new DemoAiError("upstream", DEMO_AI_ERROR_MESSAGES.upstream);
  }
}

/** Single Messages API round trip constrained to the demo JSON contract. */
export const callClaudeForDemoLanding: DemoAiCall = async ({ system, prompt }) => {
  assertServerSide();
  const config = getDemoAiConfig();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!config.configured || !apiKey) throw new DemoAiError("not_configured");

  const client = new Anthropic({
    apiKey,
    timeout: config.timeoutMs,
    maxRetries: 1,
  });

  let response;
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: buildDemoAiJsonSchema() },
      },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (cause) {
    throw toDemoAiError(cause);
  }

  if (response.stop_reason === "refusal") throw new DemoAiError("refused");
  if (response.stop_reason === "max_tokens") throw new DemoAiError("invalid_response");

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new DemoAiError("invalid_response");

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DemoAiError("invalid_response");
  }
};

/** Maps SDK failures to a safe code; upstream messages are deliberately dropped. */
export function toDemoAiError(cause: unknown): DemoAiError {
  if (cause instanceof DemoAiError) return cause;
  if (cause instanceof APIConnectionTimeoutError) return new DemoAiError("timeout");
  if (cause instanceof AuthenticationError) return new DemoAiError("unauthorized");
  if (cause instanceof RateLimitError) return new DemoAiError("rate_limited");
  if (cause instanceof BadRequestError) return new DemoAiError("upstream");
  if (cause instanceof APIError) return new DemoAiError("upstream");
  if (cause instanceof Error && cause.name === "AbortError") return new DemoAiError("timeout");
  return new DemoAiError("upstream");
}

export type DemoAiImprovement = DemoAiMergeResult & {
  attempts: number;
  model: string;
};

/**
 * Asks Claude for improved editorial copy and returns a merged draft. Any answer
 * that fails the schema or the fabrication rules is retried once with the exact
 * corrections; if it fails again the caller keeps the current content untouched.
 */
export async function improveDemoLandingContent(params: {
  current: DemoLandingContent;
  facts: DemoAiFacts;
  call?: DemoAiCall;
  maxAttempts?: number;
  model?: string;
}): Promise<DemoAiImprovement> {
  const call = params.call ?? callClaudeForDemoLanding;
  const maxAttempts = Math.max(1, Math.min(params.maxAttempts ?? 2, 3));
  const model = params.model ?? getDemoAiConfig().model;

  let corrections: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await call({
      system: DEMO_AI_SYSTEM_PROMPT,
      prompt: buildDemoAiUserPrompt({
        facts: params.facts,
        current: params.current,
        corrections,
      }),
    });

    const validation = validateDemoAiDraft(raw);
    if (validation.ok) {
      const merged = mergeDemoAiDraft({ current: params.current, draft: validation.draft });
      return { ...merged, attempts: attempt, model };
    }

    corrections = validation.corrections;
  }

  throw new DemoAiError("invalid_response");
}
