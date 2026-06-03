/**
 * Google Gemini adapter.
 *
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
 *
 * Auth is via the `x-goog-api-key` request header (see `buildHeaders`) — the
 * older `?key=…` query-param form leaked the key into browser history, fetch
 * logs, and Referer headers. CORS is permissive on this host.
 *
 * The `?alt=sse` query param flips the response format from concatenated
 * JSON arrays (the default) to standard SSE so we can reuse the shared
 * `readSseStream` reader.
 *
 * SSE payload per event:
 *   data: {"candidates":[{"content":{"parts":[{"text":"..."}]},"finishReason":...}],"usageMetadata":{...}}
 * A chunk's `parts` array can hold MORE than one entry (e.g. a `thought`
 * part alongside the answer on thinking-enabled 2.5/3 models), so we walk
 * every visible (non-thought) text part — see `geminiPartsText`.
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

/**
 * Concatenate the visible answer text across a Gemini chunk's `parts`.
 *
 * Gemini can emit multiple parts per streamed chunk; reading only `parts[0]`
 * (the prior behaviour) dropped text carried in later parts and could surface
 * a `thought` part's text as if it were the answer. We join every part whose
 * `thought` flag is unset, in order.
 */
export function geminiPartsText(
  parts: Array<{ text?: string; thought?: boolean }> | undefined
): string {
  if (!Array.isArray(parts)) return "";
  let out = "";
  for (const p of parts) {
    if (p && typeof p.text === "string" && p.text.length > 0 && !p.thought) out += p.text;
  }
  return out;
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
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = geminiPartsText(obj.candidates?.[0]?.content?.parts);
      if (text.length > 0) {
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
