/**
 * Which model server the agent talks to, and how a request to it is built.
 *
 * Shared by the owner's agent route (`/api/agent/stream`) and, later, the
 * visitor route. Edge-safe: plain Web APIs only (fetch, AbortController,
 * TransformStream, setTimeout), no Node imports, so the Edge route can use it.
 *
 * Backends, in the order the owner route tries them:
 *   1. OpenClaw, the owner's own gateway (OPENCLAW_API_KEY). It holds the GLM
 *      key on the VPS and maps `openclaw` → GLM-5.3, `openclaw-flash` →
 *      GLM-5.3-Flash. Requests carry `X-Caller: agile-toolkit` so nginx can
 *      give the toolkit its own rate-limit zone (the visitor route's say
 *      `agile-toolkit-visitor`, so visitors get a bucket of their own).
 *   2. A direct Zhipu key (GLM_API_KEY) on open.bigmodel.cn.
 *   3. A direct Z.AI key (ZAI_API_KEY) on api.z.ai. The two keys are not
 *      interchangeable: a bigmodel key 401s on api.z.ai and the other way round.
 */

export type OwnerProvider = "openclaw" | "glm" | "zai";

export interface UpstreamBackend {
  provider: OwnerProvider;
  /** Full chat-completions URL. */
  url: string;
  /** Bearer key. Server-side only; never sent to the browser or logged. */
  key: string;
  /** Model id sent upstream (the client's own `model` is never forwarded). */
  model: string;
}

type Env = Record<string, string | undefined>;

export const OPENCLAW_DEFAULT_URL = "https://chat.amrelharony.com/v1/chat/completions";
export const GLM_DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4";
export const ZAI_DEFAULT_BASE = "https://api.z.ai/api/paas/v4";

export const OPENCLAW_DEFAULT_MODEL = "openclaw";
export const GLM_DEFAULT_MODEL = "glm-4.5-flash";
export const ZAI_DEFAULT_MODEL = "glm-5.3-flash";
export const VISITOR_DEFAULT_MODEL = "openclaw-flash";

/** OpenClaw's cheaper model (GLM-5.3-Flash on the VPS), for small tool tasks. */
export const OPENCLAW_FLASH_MODEL = "openclaw-flash";

/** Sent on every OpenClaw request so the gateway's nginx can tell the toolkit apart. */
export const CALLER_HEADER = "X-Caller";
export const CALLER_NAME = "agile-toolkit";
/**
 * The visitor route's X-Caller: its own value, so nginx keeps visitors in a
 * rate-limit bucket of their own and a burst of visitor traffic can never use
 * up the owner's (RUNBOOK.md, "Visitor AI").
 */
export const VISITOR_CALLER_NAME = "agile-toolkit-visitor";

/**
 * No response headers within this long ⇒ give up with a 504. Vercel Edge
 * functions must start their response within 25s of the request, or the
 * platform answers 504 itself (without the route's error body or X-RateLimit-*
 * headers, though the turn was already metered). 20s leaves room for the
 * sign-in check, the rate-limit call and the body parse that run first.
 */
export const FIRST_BYTE_TIMEOUT_MS = 20_000;
/** No new stream chunk within this long ⇒ end the stream. Edge has no cap on a stream once it has started. */
export const IDLE_TIMEOUT_MS = 30_000;

/** Ceiling the route clamps `max_tokens` to (the reply plus GLM's reasoning). */
export const MAX_TOKENS_CEILING = 8192;
const MAX_TOKENS_FLOOR = 64;
const DEFAULT_MAX_TOKENS = 4096;

/** The only `reasoning_effort` values forwarded upstream. */
const REASONING_EFFORTS = new Set(["low", "high", "max"]);
/**
 * The backends `reasoning_effort` is forwarded to: the GLM-5.3 ones. A direct
 * bigmodel key (provider "glm", default glm-4.5-flash) never gets it, the same
 * as the browser's BYOK request to that endpoint.
 */
const REASONING_PROVIDERS = new Set<OwnerProvider>(["openclaw", "zai"]);

/** An env value with surrounding space trimmed; "" counts as unset. */
function env(e: Env, name: string): string | undefined {
  const v = e[name]?.trim();
  return v ? v : undefined;
}

/**
 * Turn a configured base URL into a chat-completions URL. Accepts either the
 * API base (`https://api.z.ai/api/paas/v4`) or the full endpoint, trims
 * trailing slashes, and refuses anything that isn't https (the bearer key must
 * never travel in the clear), falling back to `fallbackBase` instead.
 */
export function chatCompletionsUrl(raw: string | undefined, fallbackBase: string): string {
  const pick = (value: string) => {
    const trimmed = value.trim().replace(/\/+$/, "");
    return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
  };
  const candidate = raw?.trim();
  if (candidate && /^https:\/\/[^/\s]+/i.test(candidate)) return pick(candidate);
  return pick(fallbackBase);
}

/** The owner's backend: OpenClaw, then a bigmodel key, then a Z.AI key. null ⇒ BYOK client. */
export function resolveOwnerBackend(e: Env = process.env): UpstreamBackend | null {
  const openclaw = env(e, "OPENCLAW_API_KEY");
  if (openclaw) {
    return {
      provider: "openclaw",
      url: chatCompletionsUrl(env(e, "OPENCLAW_URL"), OPENCLAW_DEFAULT_URL),
      key: openclaw,
      // OpenClaw exposes `openclaw` (GLM-5.3) and `openclaw-flash`
      // (GLM-5.3-Flash) and maps them on the VPS — never the raw GLM id.
      model: env(e, "OPENCLAW_MODEL") ?? OPENCLAW_DEFAULT_MODEL,
    };
  }
  const glm = env(e, "GLM_API_KEY");
  if (glm) {
    return {
      provider: "glm",
      url: chatCompletionsUrl(env(e, "GLM_BASE_URL"), GLM_DEFAULT_BASE),
      key: glm,
      model: env(e, "GLM_AGENT_MODEL") ?? GLM_DEFAULT_MODEL,
    };
  }
  const zai = env(e, "ZAI_API_KEY");
  if (zai) {
    return {
      provider: "zai",
      url: chatCompletionsUrl(env(e, "ZAI_BASE_URL"), ZAI_DEFAULT_BASE),
      key: zai,
      model: env(e, "ZAI_AGENT_MODEL") ?? ZAI_DEFAULT_MODEL,
    };
  }
  return null;
}

/**
 * The visitors' backend: always OpenClaw (never a raw GLM key), on the cheaper
 * VISITOR_AI_MODEL. null unless VISITOR_AI_ENABLED is exactly "1" and the
 * gateway key is set, so visitors get nothing until the owner switches it on.
 */
export function resolveVisitorBackend(e: Env = process.env): UpstreamBackend | null {
  if (env(e, "VISITOR_AI_ENABLED") !== "1") return null;
  const key = env(e, "OPENCLAW_API_KEY");
  if (!key) return null;
  return {
    provider: "openclaw",
    url: chatCompletionsUrl(env(e, "OPENCLAW_URL"), OPENCLAW_DEFAULT_URL),
    key,
    model: env(e, "VISITOR_AI_MODEL") ?? VISITOR_DEFAULT_MODEL,
  };
}

/** How big a model a tool task needs: the cheap, quick one or the full one. */
export type ModelTier = "flash" | "full";

/**
 * The model id for one tool AI task (lib/ai), by tier. The owner's chat keeps
 * using `backend.model` as it is; only the tool routes call this.
 *
 * - OpenClaw, owner: `openclaw-flash` for "flash", OPENCLAW_MODEL (default
 *   `openclaw`, which is `backend.model`) for "full".
 * - A direct bigmodel key: its flash model for "flash", GLM_AGENT_MODEL
 *   (`backend.model`) for "full".
 * - A direct Z.AI key: the same, with Z.AI's flash model.
 * - The visitors' backend (`audience: "visitor"`): always its own
 *   VISITOR_AI_MODEL (`backend.model`), whatever the tier, so a visitor can
 *   never reach the full model.
 */
export function pickModel(
  backend: Pick<UpstreamBackend, "provider" | "model">,
  tier: ModelTier,
  audience: "owner" | "visitor" = "owner"
): string {
  if (audience === "visitor" || tier === "full") return backend.model;
  switch (backend.provider) {
    case "openclaw":
      return OPENCLAW_FLASH_MODEL;
    case "glm":
      return GLM_DEFAULT_MODEL;
    case "zai":
      return ZAI_DEFAULT_MODEL;
  }
}

/** The `reasoning_effort` levels, lowest first. */
export type ReasoningEffortLevel = "low" | "high" | "max";
const EFFORT_RANK: Record<ReasoningEffortLevel, number> = { low: 0, high: 1, max: 2 };

/**
 * The lower of two efforts (low < high < max). A missing or unknown `b` leaves
 * `a`, so a task's own effort applies when no cap is set; the visitor config
 * row's effort is passed as `b`, so it still works as a brake.
 */
export function minEffort(
  a: ReasoningEffortLevel,
  b?: ReasoningEffortLevel | null
): ReasoningEffortLevel {
  if (!b || !(b in EFFORT_RANK)) return a;
  return EFFORT_RANK[b] < EFFORT_RANK[a] ? b : a;
}

/**
 * Request headers for a backend: JSON, the bearer key, and X-Caller for
 * OpenClaw (`caller`: CALLER_NAME for the owner, VISITOR_CALLER_NAME for the
 * visitor route).
 */
export function upstreamHeaders(
  b: Pick<UpstreamBackend, "provider" | "key">,
  caller: string = CALLER_NAME
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${b.key}`,
  };
  if (b.provider === "openclaw") headers[CALLER_HEADER] = caller;
  return headers;
}

export interface OpenAiToolDef {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
}

/**
 * Keep only well-formed function tools: `{type:"function", function:{name}}`
 * with a 1–`maxNameLen` character name. Anything else a client sends is
 * dropped rather than forwarded (BUG-G12). Entries that pass are forwarded as
 * sent, in order.
 *
 * At most `max` of them, not counting those named in `keep` (the functions the
 * history's tool_calls call): the endpoint rejects a request whose history
 * calls a function missing from `tools`, so cutting one would fail the turn,
 * and every later turn of that conversation, with a 400.
 */
export function sanitizeTools(
  raw: unknown,
  {
    max = Number.POSITIVE_INFINITY,
    maxNameLen = 128,
    keep,
  }: { max?: number; maxNameLen?: number; keep?: ReadonlySet<string> } = {}
): OpenAiToolDef[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenAiToolDef[] = [];
  let capped = 0;
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const tt = t as Record<string, unknown>;
    if (tt.type !== "function") continue;
    const fn = tt.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn !== "object" || typeof fn.name !== "string") continue;
    if (fn.name.length === 0 || fn.name.length > maxNameLen) continue;
    if (!keep?.has(fn.name)) {
      if (capped >= max) continue;
      capped++;
    }
    out.push(t as OpenAiToolDef);
  }
  return out;
}

/** Function names the assistant tool_calls in a chat-completions `messages` array call. */
export function toolCallNames(messages: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(messages)) return names;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const calls = (m as { role?: unknown; tool_calls?: unknown }).tool_calls;
    if ((m as { role?: unknown }).role !== "assistant" || !Array.isArray(calls)) continue;
    for (const c of calls) {
      const name = (c as { function?: { name?: unknown } } | null)?.function?.name;
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

/**
 * Build the body sent upstream from what the browser posted. Only whitelisted
 * fields are copied; the model, streaming and usage reporting are set here:
 *
 * - `tool_choice` is always "auto" when tools are offered and left out
 *   otherwise. GLM-5.3 documents only "auto", so the client's "none",
 *   "required" or a named function are not forwarded.
 * - `reasoning_effort` is forwarded only as "low", "high" or "max", and only
 *   to OpenClaw and Z.AI (GLM-5.3), never to a direct bigmodel key.
 * - `thinking` is forwarded only to a direct bigmodel key (provider "glm").
 *   GLM-5.3's thinking is always on and can't be switched off, so it means
 *   nothing to OpenClaw or Z.AI.
 */
export function buildUpstreamBody(
  raw: Record<string, unknown>,
  backend: Pick<UpstreamBackend, "provider" | "model">,
  opts: { maxTools?: number } = {}
): Record<string, unknown> {
  const forward: Record<string, unknown> = {
    model: backend.model,
    stream: true,
    // BUG-H3: ask for the trailing usage chunk so token metering works.
    // Set here, never copied from the client.
    stream_options: { include_usage: true },
    // Number.isFinite rejects NaN/±Infinity, which `typeof === "number"`
    // alone lets through (they'd be forwarded as `null`).
    max_tokens: Number.isFinite(raw.max_tokens)
      ? Math.min(
          MAX_TOKENS_CEILING,
          Math.max(MAX_TOKENS_FLOOR, Math.floor(raw.max_tokens as number))
        )
      : DEFAULT_MAX_TOKENS,
  };
  // generateTitle sends a low temperature for stable titles; clamp to [0, 2].
  if (typeof raw.temperature === "number" && Number.isFinite(raw.temperature)) {
    forward.temperature = Math.min(2, Math.max(0, raw.temperature));
  }
  if (Array.isArray(raw.messages)) forward.messages = raw.messages;
  const tools = sanitizeTools(raw.tools, {
    max: opts.maxTools,
    keep: toolCallNames(raw.messages),
  });
  if (tools.length > 0) {
    forward.tools = tools;
    forward.tool_choice = "auto";
  }
  if (
    REASONING_PROVIDERS.has(backend.provider) &&
    typeof raw.reasoning_effort === "string" &&
    REASONING_EFFORTS.has(raw.reasoning_effort)
  ) {
    forward.reasoning_effort = raw.reasoning_effort;
  }
  // BUG-G13: validate the shape (boolean or plain object) so the client can't
  // pass arbitrary upstream parameters through it.
  if (backend.provider === "glm") {
    if (typeof raw.thinking === "boolean") {
      forward.thinking = raw.thinking;
    } else if (raw.thinking && typeof raw.thinking === "object" && !Array.isArray(raw.thinking)) {
      forward.thinking = raw.thinking;
    }
  }
  return forward;
}

export type FirstByteResult =
  | { ok: true; response: Response }
  | { ok: false; reason: "timeout" | "aborted" | "network" };

/**
 * fetch() that gives up when no response headers arrive within `timeoutMs`.
 * The caller's `controller` is aborted on timeout, which also cancels the
 * upstream request so the gateway stops generating. Never throws: a timeout,
 * a caller abort and a network failure each come back as a reason.
 */
export async function fetchWithFirstByteTimeout(
  url: string,
  init: Omit<RequestInit, "signal">,
  opts: { controller: AbortController; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<FirstByteResult> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    opts.controller.abort();
  }, opts.timeoutMs ?? FIRST_BYTE_TIMEOUT_MS);
  try {
    const response = await (opts.fetchImpl ?? fetch)(url, {
      ...init,
      signal: opts.controller.signal,
    });
    return { ok: true, response };
  } catch {
    if (timedOut) return { ok: false, reason: "timeout" };
    return { ok: false, reason: opts.controller.signal.aborted ? "aborted" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `source` passed through untouched, but errored when no chunk arrives for
 * `timeoutMs` (a stalled gateway would otherwise hold the browser's turn open
 * until the platform kills the function). The timer restarts on every chunk;
 * `onIdle` runs once on a timeout so the caller can abort the upstream fetch.
 *
 * The timer stops for good however the stream ends: the source closes or
 * errors, the reader cancels (the browser went away), or the caller calls
 * `stop()`. A wrapping ReadableStream rather than a TransformStream, because a
 * transformer only hears about a normal end (flush) — the `cancel` hook that
 * would cover the rest isn't in every runtime.
 */
export function idleTimeoutStream(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number,
  onIdle: () => void
): { stream: ReadableStream<Uint8Array>; stop: () => void } {
  const reader = source.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The timer is off for good (the stream ended, or `stop()`). */
  let disarmed = false;
  /** The stream is over: closed, errored or cancelled. */
  let finished = false;
  const stop = () => {
    disarmed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (disarmed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (finished) return;
      finished = true;
      stop();
      try {
        controller?.error(new Error("upstream_idle_timeout"));
      } catch {
        /* the stream already ended */
      }
      reader.cancel().catch(() => {});
      onIdle();
    }, timeoutMs);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      arm();
    },
    async pull(c) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        if (finished) return;
        finished = true;
        stop();
        c.error(err);
        return;
      }
      // Timed out or cancelled while this read was waiting.
      if (finished) return;
      if (result.done) {
        finished = true;
        stop();
        c.close();
        return;
      }
      arm();
      c.enqueue(result.value);
    },
    cancel(reason) {
      finished = true;
      stop();
      return reader.cancel(reason).catch(() => {});
    },
  });
  return { stream, stop };
}
