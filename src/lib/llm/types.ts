/**
 * Shared LLM-provider types.
 *
 * Kept deliberately tiny so this module can live in the eager bundle (it's
 * imported by the status chip + use-active-llm hook). The actual adapter
 * implementations live in `./adapters/*` and are dynamic-imported via
 * `./registry.ts` so non-AI users pay zero bundle cost.
 */

export type ProviderId = "anthropic" | "openai" | "gemini" | "glm";

/** Per-model pricing + context budget for the cost-estimate UI. */
export interface ModelInfo {
  id: string;
  label: string;
  contextWindow: number;
  /** USD per 1K input tokens. */
  inputPer1k: number;
  /** USD per 1K output tokens. */
  outputPer1k: number;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface LlmCallParams {
  prompt: string;
  system?: string;
  signal: AbortSignal;
  /** Streaming callback — fired per chunk of decoded text. */
  onChunk: (text: string) => void;
}

export interface LlmCallResult {
  /** Best-effort token counts; providers vary. -1 means unknown. */
  inputTokens: number;
  outputTokens: number;
}

export interface LlmAdapter {
  id: ProviderId;
  /** Models exposed in the settings UI. Lazy importing keeps the pricing
   *  table out of the eager bundle. */
  models: readonly ModelInfo[];
  /** Default model id to seed the settings dropdown with. */
  defaultModelId: string;
  call(params: LlmCallParams, cfg: ProviderConfig, maxOutputTokens: number): Promise<LlmCallResult>;
  /** Cheap auth-only probe used by the "Test" button. Throws on failure. */
  testKey(cfg: ProviderConfig): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────
// Error taxonomy
//
// Adapters throw one of these so the UI can render specific toasts
// without parsing raw provider responses or risking key exposure in
// the error message.
// ──────────────────────────────────────────────────────────────────────

export class LlmAuthError extends Error {
  readonly code = "auth" as const;
  constructor(message = "Invalid API key") {
    super(message);
    this.name = "LlmAuthError";
  }
}

export class LlmRateLimitError extends Error {
  readonly code = "rate_limit" as const;
  /** Seconds to wait per the provider's Retry-After header (best effort). */
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null, message = "Rate limited") {
    super(message);
    this.name = "LlmRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class LlmCorsError extends Error {
  readonly code = "cors" as const;
  constructor(message = "Browser blocked the request (CORS)") {
    super(message);
    this.name = "LlmCorsError";
  }
}

export class LlmAbortError extends Error {
  readonly code = "abort" as const;
  constructor(message = "Aborted") {
    super(message);
    this.name = "LlmAbortError";
  }
}

export class LlmNetworkError extends Error {
  readonly code = "network" as const;
  /** HTTP status when known. */
  readonly status?: number;
  constructor(message = "Network error", status?: number) {
    super(message);
    this.name = "LlmNetworkError";
    this.status = status;
  }
}

export type LlmError =
  | LlmAuthError
  | LlmRateLimitError
  | LlmCorsError
  | LlmAbortError
  | LlmNetworkError;

/** Type-guard helper — adapters throw `Error` so the UI needs to test the
 *  `code` field instead of `instanceof` checks (which break across HMR
 *  module replacement). */
export function isLlmError(e: unknown): e is LlmError {
  return (
    e instanceof Error &&
    typeof (e as Error & { code?: unknown }).code === "string" &&
    ["auth", "rate_limit", "cors", "abort", "network"].includes(
      (e as Error & { code: string }).code
    )
  );
}
