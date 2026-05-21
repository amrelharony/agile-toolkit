/**
 * Generic Server-Sent-Events reader over a `fetch().body` ReadableStream.
 *
 * Every LLM provider we support (Anthropic, OpenAI, Gemini, GLM) ships its
 * streaming responses as SSE: `data: <json>\n\n` lines terminated by
 * `data: [DONE]` (OpenAI/GLM) or by stream close (Anthropic/Gemini).
 *
 * Shared so each adapter only owns the JSON-shape parsing — not the byte-
 * level frame splitting, which is identical across providers.
 *
 * Implemented as a callback-based pump rather than an `AsyncIterable` so
 * the surface compiles cleanly under the project's TS target (no `for await
 * … of` requirement).
 */

import { LlmAbortError, LlmCorsError, LlmNetworkError } from "./types";

export interface SseEvent {
  /** The payload string after `data: ` prefix removal. */
  data: string;
}

/**
 * Drain a Response body as a series of SSE events.
 *
 * The pump:
 *   - decodes incoming bytes incrementally via TextDecoder so multi-byte
 *     UTF-8 sequences aren't split across chunks
 *   - splits the buffer on `\n\n` (the SSE event terminator) so partial
 *     events at the end of a chunk wait for the next read
 *   - strips the `data: ` prefix and emits the raw payload string
 *   - terminates cleanly when the underlying reader closes
 *   - cancels the reader on AbortSignal so providers stop billing
 *     mid-stream (and so we don't leak the connection)
 *
 * Returns when the stream is exhausted or aborts. Throws LlmAbortError on
 * abort so callers can distinguish that from genuine errors.
 */
export async function pumpSseStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => void
): Promise<void> {
  if (!response.body) {
    throw new LlmNetworkError("Response had no body", response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Wire the abort signal to the reader so the stream tears down promptly
  // instead of running until the provider closes the connection.
  const onAbort = () => {
    void reader.cancel().catch(() => {
      /* swallow — reader may already be closed */
    });
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) {
        throw new LlmAbortError();
      }
      const { done, value } = await reader.read();
      if (done) {
        // Flush any trailing buffer in case the server didn't send a
        // final \n\n (rare, but observed on flaky networks).
        if (buffer.trim().length > 0) {
          emitEvents(buffer + "\n\n", onEvent);
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      // Split off complete events; keep the partial tail for next iteration.
      const lastBoundary = buffer.lastIndexOf("\n\n");
      if (lastBoundary === -1) continue;
      const complete = buffer.slice(0, lastBoundary + 2);
      buffer = buffer.slice(lastBoundary + 2);
      emitEvents(complete, onEvent);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* may already be cancelled */
    }
  }
}

function emitEvents(chunk: string, onEvent: (event: SseEvent) => void): void {
  const rawEvents = chunk.split("\n\n");
  for (let i = 0; i < rawEvents.length; i++) {
    const trimmed = rawEvents[i].trim();
    if (!trimmed) continue;
    // An SSE event can include multiple lines; we only care about `data:`
    // lines and we join multi-line payloads with `\n` as per the spec.
    const lines = trimmed.split("\n");
    const dataLines: string[] = [];
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    onEvent({ data: dataLines.join("\n") });
  }
}

/**
 * Wraps `fetch` so adapters can throw the right typed error class without
 * each one duplicating the CORS / abort / network branch logic.
 *
 * Returns the Response on success. Adapters then check `response.ok` and
 * raise `LlmAuthError` / `LlmRateLimitError` based on the status code.
 */
export async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (init.signal?.aborted) throw new LlmAbortError();
    // Distinguish a CORS failure from a generic network failure. Browsers
    // expose CORS as a TypeError with a message that varies per engine —
    // we accept the false-positive cost of treating any unrecognised
    // TypeError as a CORS error since the remediation hint is useful.
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof TypeError) {
      throw new LlmCorsError(
        `Browser blocked the request — provider CORS policy may have changed. (${message})`
      );
    }
    throw new LlmNetworkError(message);
  }
}
