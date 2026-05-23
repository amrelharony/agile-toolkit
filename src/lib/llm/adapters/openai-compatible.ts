/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Shared by both OpenAI and Zhipu's GLM/BigModel — the wire format is
 * identical (chat/completions endpoint, Bearer auth, same SSE event shape),
 * only the base URL and model ids differ. Keeping it in one file means
 * the bug fixes and edge-case handling stay aligned between providers.
 *
 * SSE payloads look like:
 *   data: {"choices":[{"delta":{"content":" hello"}}]}
 *   data: [DONE]
 *
 * Usage tokens arrive in the final non-[DONE] event when `stream_options:
 * { include_usage: true }` is set, which we always set.
 */

import {
  LlmAdapter,
  LlmAuthError,
  LlmCallParams,
  LlmCallResult,
  LlmNetworkError,
  LlmRateLimitError,
  ProviderConfig,
  ProviderId,
} from "../types";
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER } from "../pricing";
import { pumpSseStream, safeFetch } from "../stream-sse";

function parseRetryAfter(h: Headers): number | null {
  const raw = h.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * OpenAI reasoning-class models (o1, o3, o4, o3-mini, o4-mini, gpt-5-*)
 * REJECT `max_tokens` with HTTP 400 — the API expects
 * `max_completion_tokens` instead. Older chat models (gpt-3.5, gpt-4,
 * gpt-4o, gpt-4-turbo) still expect `max_tokens` and reject the
 * `max_completion_tokens` field on some endpoints, so we have to send
 * exactly one based on the model id.
 *
 * Matches at the START of the model id so suffixed variants like
 * `o1-2024-12-17`, `o3-mini`, `gpt-5-mini-2025` all resolve correctly.
 * Plain `gpt-4-...` and `gpt-3.5-...` deliberately do NOT match because
 * those are not reasoning models.
 */
const OPENAI_REASONING_MODEL_RE = /^(?:o1|o3|o4|gpt-5)(?:[-.]|$)/i;

function isReasoningModel(modelId: string): boolean {
  return OPENAI_REASONING_MODEL_RE.test(modelId);
}

/**
 * Build the token-limit field for the request body keyed on whether the
 * model is a reasoning-class model. Returns an object suitable for
 * spreading into the JSON body.
 */
function tokenLimitField(modelId: string, maxTokens: number): Record<string, number> {
  return isReasoningModel(modelId)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

/**
 * AbortSignal.any() polyfill — older browsers (Safari < 17.5) lack it but
 * the project supports them. Returns a signal that aborts when ANY input
 * signal aborts. Used to combine the user's Stop button with our internal
 * `[DONE]` sentinel so a single pump call can terminate cleanly on either.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) controller.abort();
  else {
    a.addEventListener("abort", onAbort, { once: true });
    b.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

async function raiseHttpError(provider: string, response: Response): Promise<never> {
  if (response.status === 401 || response.status === 403) {
    throw new LlmAuthError(`${provider} rejected the API key`);
  }
  if (response.status === 429) {
    throw new LlmRateLimitError(parseRetryAfter(response.headers), `${provider} rate limited`);
  }
  let body = "";
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  throw new LlmNetworkError(
    `${provider} ${response.status}: ${body || response.statusText}`,
    response.status
  );
}

/**
 * Factory — produces an adapter bound to a specific provider id and base URL.
 * Both produced adapters share the same code path; only model lists differ
 * (via the per-provider pricing table).
 */
function createOpenAiCompatible(
  providerId: ProviderId,
  displayName: string,
  baseUrl: string
): LlmAdapter {
  const endpoint = `${baseUrl}/chat/completions`;

  return {
    id: providerId,
    models: MODELS_BY_PROVIDER[providerId],
    defaultModelId: DEFAULT_MODEL_BY_PROVIDER[providerId],

    async call(
      params: LlmCallParams,
      cfg: ProviderConfig,
      maxOutputTokens: number
    ): Promise<LlmCallResult> {
      const messages: Array<{ role: string; content: string }> = [];
      if (params.system) messages.push({ role: "system", content: params.system });
      messages.push({ role: "user", content: params.prompt });

      const response = await safeFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          stream: true,
          // OpenAI returns usage in the final SSE event only when this flag
          // is set; GLM tolerates the flag and returns usage similarly.
          stream_options: { include_usage: true },
          // o-series / gpt-5 reasoning models require `max_completion_tokens`
          // (the OpenAI API returns HTTP 400 for `max_tokens` on these
          // models). Older chat models still expect `max_tokens`. Pick at
          // request time so the same adapter handles both families.
          ...tokenLimitField(cfg.model, maxOutputTokens),
          messages,
        }),
        signal: params.signal,
      });

      if (!response.ok) await raiseHttpError(displayName, response);

      let inputTokens = -1;
      let outputTokens = -1;
      // OpenAI/GLM stream emit a final `[DONE]` sentinel — once seen we tell
      // the abort signal to terminate the reader cleanly. Throwing inside
      // the callback would leak the reader, so use an explicit AbortController.
      const doneSignal = new AbortController();
      const combinedSignal = combineSignals(params.signal, doneSignal.signal);

      await pumpSseStream(response, combinedSignal, (ev) => {
        if (ev.data === "[DONE]") {
          doneSignal.abort();
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const obj = payload as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (obj.usage) {
          if (typeof obj.usage.prompt_tokens === "number") inputTokens = obj.usage.prompt_tokens;
          if (typeof obj.usage.completion_tokens === "number") outputTokens = obj.usage.completion_tokens;
        }
        const text = obj.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length > 0) {
          params.onChunk(text);
        }
      }).catch((err: unknown) => {
        // The `[DONE]` abort is expected — re-throw anything else.
        if (doneSignal.signal.aborted && !params.signal.aborted) return;
        throw err;
      });

      return { inputTokens, outputTokens };
    },

    async testKey(cfg: ProviderConfig): Promise<void> {
      // Minimal probe — most OpenAI-compatible servers accept max_tokens: 1.
      const response = await safeFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          // Reasoning models reject `max_tokens` — see tokenLimitField above.
          ...tokenLimitField(cfg.model, 1),
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!response.ok) await raiseHttpError(displayName, response);
      try {
        await response.text();
      } catch {
        /* ignore */
      }
    },
  };
}

export const openaiAdapter: LlmAdapter = createOpenAiCompatible(
  "openai",
  "OpenAI",
  "https://api.openai.com/v1"
);

export const glmAdapter: LlmAdapter = createOpenAiCompatible(
  "glm",
  "GLM (BigModel)",
  "https://open.bigmodel.cn/api/paas/v4"
);
