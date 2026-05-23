/**
 * Google Gemini adapter.
 *
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
 *
 * Auth is via API key in the query string (`?key=…`), which Google's Gemini
 * docs describe as the supported way to call directly from a browser. CORS
 * is permissive on this host.
 *
 * The `?alt=sse` query param flips the response format from concatenated
 * JSON arrays (the default) to standard SSE so we can reuse the shared
 * `readSseStream` reader.
 *
 * SSE payload per event:
 *   data: {"candidates":[{"content":{"parts":[{"text":"..."}]},"finishReason":...}],"usageMetadata":{...}}
 */

import {
  LlmAdapter,
  LlmAuthError,
  LlmCallParams,
  LlmCallResult,
  LlmNetworkError,
  LlmRateLimitError,
  ProviderConfig,
} from "../types";
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER } from "../pricing";
import { pumpSseStream, safeFetch } from "../stream-sse";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function buildUrl(model: string, action: "stream" | "test"): string {
  const path = action === "stream" ? `${model}:streamGenerateContent` : `${model}:generateContent`;
  // alt=sse is REQUIRED for the streaming variant; without it Google sends
  // a single concatenated-JSON body that breaks our SSE reader.
  return action === "stream" ? `${BASE}/${path}?alt=sse` : `${BASE}/${path}`;
}

function buildHeaders(apiKey: string): HeadersInit {
  // Use the x-goog-api-key header instead of the `?key=` query param.
  // The prior URL form put the key in browser history, fetch entry
  // server logs, and Referer headers sent to embedded resources. The
  // header form is what Anthropic / OpenAI use and what Google's own
  // SDKs prefer — equivalent auth, no leakage surface.
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

function parseRetryAfter(h: Headers): number | null {
  const raw = h.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function raiseHttpError(response: Response): Promise<never> {
  if (response.status === 401 || response.status === 403) {
    throw new LlmAuthError("Gemini rejected the API key");
  }
  if (response.status === 429) {
    throw new LlmRateLimitError(parseRetryAfter(response.headers), "Gemini rate limited");
  }
  let body = "";
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  throw new LlmNetworkError(
    `Gemini ${response.status}: ${body || response.statusText}`,
    response.status
  );
}

export const geminiAdapter: LlmAdapter = {
  id: "gemini",
  models: MODELS_BY_PROVIDER.gemini,
  defaultModelId: DEFAULT_MODEL_BY_PROVIDER.gemini,

  async call(
    params: LlmCallParams,
    cfg: ProviderConfig,
    maxOutputTokens: number
  ): Promise<LlmCallResult> {
    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: { maxOutputTokens },
    };
    if (params.system) {
      // Gemini accepts a top-level system instruction object instead of a
      // role-tagged message — the model would otherwise ignore a "system"
      // role inside `contents`.
      body.systemInstruction = { parts: [{ text: params.system }] };
    }

    const response = await safeFetch(buildUrl(cfg.model, "stream"), {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) await raiseHttpError(response);

    let inputTokens = -1;
    let outputTokens = -1;

    await pumpSseStream(response, params.signal, (ev) => {
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      const obj = payload as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.length > 0) {
        params.onChunk(text);
      }
      if (obj.usageMetadata) {
        if (typeof obj.usageMetadata.promptTokenCount === "number") {
          inputTokens = obj.usageMetadata.promptTokenCount;
        }
        if (typeof obj.usageMetadata.candidatesTokenCount === "number") {
          outputTokens = obj.usageMetadata.candidatesTokenCount;
        }
      }
    });

    return { inputTokens, outputTokens };
  },

  async testKey(cfg: ProviderConfig): Promise<void> {
    // Non-streaming probe so we don't have to drain an SSE body.
    const response = await safeFetch(buildUrl(cfg.model, "test"), {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    if (!response.ok) await raiseHttpError(response);
    try {
      await response.text();
    } catch {
      /* ignore */
    }
  },
};
