/**
 * Anthropic Messages API adapter.
 *
 * Endpoint: https://api.anthropic.com/v1/messages
 *
 * Browser-direct calls require the `anthropic-dangerous-direct-browser-access`
 * header — this is Anthropic's explicit BYOK escape hatch, documented at
 * https://docs.anthropic.com/en/api/client-sdks#enabling-direct-browser-access.
 * Without it the request is blocked with a 403.
 *
 * Streaming is SSE with these event kinds we care about:
 *   - `content_block_delta`  →  { delta: { type: "text_delta", text: "..." } }
 *   - `message_delta`        →  { usage: { input_tokens, output_tokens } }
 *   - `message_stop`         →  end-of-stream sentinel
 */

import {
  LlmAdapter,
  LlmAuthError,
  LlmCallParams,
  LlmCallResult,
  LlmRateLimitError,
  LlmNetworkError,
  ProviderConfig,
} from "../types";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "../pricing";
import { pumpSseStream, safeFetch } from "../stream-sse";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

function buildHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    // Required for browser-direct calls — see file header.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function parseRetryAfter(h: Headers): number | null {
  const raw = h.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Anthropic returns errors as JSON:
 *   { "type": "error", "error": { "type": "...", "message": "..." } }
 * Reading the body once and surfacing `error.message` gives the user
 * something actionable (e.g. "max_tokens: 200000 > 8192 limit for
 * claude-haiku-4-5") rather than a raw "Anthropic 400" toast.
 */
async function readAnthropicErrorMessage(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 1500);
    if (!text) return response.statusText;
    try {
      const json = JSON.parse(text) as {
        error?: { message?: string; type?: string };
      };
      if (json?.error?.message) {
        const prefix = json.error.type ? `${json.error.type}: ` : "";
        return `${prefix}${json.error.message}`.slice(0, 300);
      }
    } catch {
      /* not JSON — fall through */
    }
    return text.slice(0, 300);
  } catch {
    return response.statusText;
  }
}

async function raiseHttpError(response: Response): Promise<never> {
  const msg = await readAnthropicErrorMessage(response);
  if (response.status === 401 || response.status === 403) {
    throw new LlmAuthError(msg || "Anthropic rejected the API key");
  }
  if (response.status === 429) {
    throw new LlmRateLimitError(
      parseRetryAfter(response.headers),
      msg || "Anthropic rate limited"
    );
  }
  // 529 = overloaded_error. Treat as a retryable rate-limit rather than a
  // hard network failure so the caller's backoff kicks in.
  if (response.status === 529) {
    throw new LlmRateLimitError(
      parseRetryAfter(response.headers) ?? 5,
      msg || "Anthropic overloaded — try again shortly"
    );
  }
  throw new LlmNetworkError(`Anthropic ${response.status}: ${msg}`, response.status);
}

export const anthropicAdapter: LlmAdapter = {
  id: "anthropic",
  models: MODELS_BY_PROVIDER.anthropic,
  defaultModelId: DEFAULT_MODEL_BY_PROVIDER.anthropic,

  async call(
    params: LlmCallParams,
    cfg: ProviderConfig,
    maxOutputTokens: number
  ): Promise<LlmCallResult> {
    const body = {
      model: cfg.model,
      max_tokens: maxOutputTokens,
      stream: true,
      ...(params.system ? { system: params.system } : {}),
      messages: [{ role: "user", content: params.prompt }],
    };

    const response = await safeFetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) await raiseHttpError(response);

    let inputTokens = -1;
    let outputTokens = -1;

    await pumpSseStream(response, params.signal, (ev) => {
      // Anthropic sends a final `event: message_stop` whose data line is
      // `{"type":"message_stop"}` — we just rely on stream close.
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      const obj = payload as Record<string, unknown>;
      const type = obj.type;

      if (type === "content_block_delta") {
        const delta = obj.delta as { type?: string; text?: string } | undefined;
        if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
          params.onChunk(delta.text);
        }
      } else if (type === "message_start") {
        const message = obj.message as { usage?: { input_tokens?: number } } | undefined;
        if (message?.usage?.input_tokens != null) inputTokens = message.usage.input_tokens;
      } else if (type === "message_delta") {
        const usage = obj.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens != null) outputTokens = usage.output_tokens;
      }
    });

    return { inputTokens, outputTokens };
  },

  async testKey(cfg: ProviderConfig): Promise<void> {
    // 1-token probe: cheaper than a full call and surfaces 401 immediately.
    const response = await safeFetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (!response.ok) await raiseHttpError(response);
    // Drain the body so the connection can be reused.
    try {
      await response.text();
    } catch {
      /* ignore */
    }
  },
};
