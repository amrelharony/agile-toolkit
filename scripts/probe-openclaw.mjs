#!/usr/bin/env node
/**
 * Probe the OpenClaw gateway before the toolkit relies on it.
 *
 * Usage — type the key at a hidden prompt in your own terminal, so it never
 * lands in shell history or on a command line (this script never prints it):
 *   bash:        read -rs OPENCLAW_API_KEY && export OPENCLAW_API_KEY
 *   PowerShell:  $s = Read-Host -AsSecureString
 *                $env:OPENCLAW_API_KEY = [Net.NetworkCredential]::new('', $s).Password
 * then:
 *   node scripts/probe-openclaw.mjs                    (visitors' model, openclaw-flash)
 *   node scripts/probe-openclaw.mjs --model openclaw   (the owner's model)
 *
 * Env:
 *   OPENCLAW_API_KEY  the gateway's bearer key (required; read from the env only)
 *   OPENCLAW_URL      chat-completions URL
 *                     (default https://chat.amrelharony.com/v1/chat/completions)
 * Flags:
 *   --model <id>      model to ask for (default openclaw-flash, the visitors' model)
 *
 * Every request carries `X-Caller: agile-toolkit`, as the toolkit's do. Five
 * checks, printed as a PASS / FAIL / INFO table:
 *   1. Streaming text arrives.
 *   2. A tool call round-trips: the model calls the offered function with
 *      finish_reason "tool_calls", gets the result, and answers in text.
 *   3. Whether `reasoning_content` deltas appear (INFO; GLM-5.3 always reasons).
 *   4. Whether a `usage` chunk arrives (INFO; token metering needs it).
 *   5. A ~60 KB request body is accepted (not 413 from nginx).
 * Exits 1 when check 1, 2 or 5 fails; 2 when the key is missing.
 *
 * No dependencies: Node 18+ (global fetch and Web Streams).
 */

const DEFAULT_URL = "https://chat.amrelharony.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const KEY = (process.env.OPENCLAW_API_KEY ?? "").trim();
const URL_ = (process.env.OPENCLAW_URL ?? "").trim() || DEFAULT_URL;
const MODEL = arg("model", "openclaw-flash");

if (!KEY) {
  console.error("OPENCLAW_API_KEY is not set. Set it in this terminal, then run the probe again.");
  process.exit(2);
}
if (!/^https:\/\//i.test(URL_)) {
  console.error("OPENCLAW_URL must be an https:// URL (the key must not travel in the clear).");
  process.exit(2);
}

/** Never let the key reach the console, even inside an echoed error body. */
function redact(text) {
  return String(text).split(KEY).join("[redacted]");
}

function headers() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${KEY}`,
    "X-Caller": "agile-toolkit",
  };
}

/** POST a chat-completions body; resolves with the Response (headers received). */
async function post(body, controller = new AbortController()) {
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const started = Date.now();
    const res = await fetch(URL_, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { res, firstByteMs: Date.now() - started, timer };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Read an OpenAI-style SSE stream to the end and summarise it: the text, any
 * tool calls, the finish reason, and whether reasoning or usage showed up.
 */
async function readStream(res) {
  const out = {
    text: "",
    contentChunks: 0,
    reasoningChunks: 0,
    usage: null,
    finishReason: null,
    toolCalls: new Map(),
    events: 0,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const handle = (raw) => {
    const data = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    out.events++;
    if (payload.usage && typeof payload.usage === "object") out.usage = payload.usage;
    const choice = payload.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      out.text += delta.content;
      out.contentChunks++;
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      out.reasoningChunks++;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === "number" ? tc.index : 0;
        const cur = out.toolCalls.get(index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        out.toolCalls.set(index, cur);
      }
    }
    if (choice.finish_reason) out.finishReason = choice.finish_reason;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    let nl;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 2);
    }
  }
  if (buf.trim()) handle(buf);
  return out;
}

async function failDetail(res) {
  let body = "";
  try {
    body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
  } catch {
    /* ignore */
  }
  return redact(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
}

const results = [];
function record(n, name, status, detail) {
  results.push({ n, name, status, detail });
}

const seen = { reasoning: false, usage: false, usageSample: null };
function note(stream) {
  if (stream.reasoningChunks > 0) seen.reasoning = true;
  if (stream.usage) {
    seen.usage = true;
    seen.usageSample ??= stream.usage;
  }
}

// ── 1. Streaming text ────────────────────────────────────────────────────
async function checkStreaming() {
  const { res, firstByteMs, timer } = await post({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1024,
    messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
  });
  try {
    if (!res.ok || !res.body) return record(1, "Streaming text", "FAIL", await failDetail(res));
    const s = await readStream(res);
    note(s);
    if (s.contentChunks === 0) {
      return record(1, "Streaming text", "FAIL", `no content deltas (${s.events} events)`);
    }
    record(
      1,
      "Streaming text",
      "PASS",
      `${s.contentChunks} content chunk(s), first byte ${(firstByteMs / 1000).toFixed(1)}s, reply "${s.text.trim().slice(0, 40)}"`
    );
  } finally {
    clearTimeout(timer);
  }
}

// ── 2. Tool-call round trip ─────────────────────────────────────────────
const TOOL = {
  type: "function",
  function: {
    name: "lookup_sprint",
    description: "Look up a sprint by name and return its goal.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "The sprint's name" } },
      required: ["name"],
    },
  },
};

async function checkToolRoundTrip() {
  const userMsg = {
    role: "user",
    content:
      'Use the lookup_sprint tool to find the goal of the sprint named "Sprint 47", then tell me the goal in one sentence.',
  };
  const first = await post({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 2048,
    tools: [TOOL],
    tool_choice: "auto",
    messages: [userMsg],
  });
  let call;
  let assistantText = "";
  try {
    if (!first.res.ok || !first.res.body) {
      return record(2, "Tool-call round trip", "FAIL", await failDetail(first.res));
    }
    const s = await readStream(first.res);
    note(s);
    assistantText = s.text;
    call = [...s.toolCalls.values()].find((c) => c.name === TOOL.function.name);
    if (!call || s.finishReason !== "tool_calls") {
      return record(
        2,
        "Tool-call round trip",
        "FAIL",
        `expected a lookup_sprint call with finish_reason "tool_calls"; got ${s.toolCalls.size} call(s), finish_reason ${JSON.stringify(s.finishReason)}`
      );
    }
    try {
      JSON.parse(call.args || "{}");
    } catch {
      return record(2, "Tool-call round trip", "FAIL", "tool call arguments are not valid JSON");
    }
  } finally {
    clearTimeout(first.timer);
  }

  const callId = call.id || "call_probe_1";
  const second = await post({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 2048,
    tools: [TOOL],
    tool_choice: "auto",
    messages: [
      userMsg,
      {
        role: "assistant",
        content: assistantText || null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name: call.name, arguments: call.args || "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({ name: "Sprint 47", goal: "Ship the probe script" }),
      },
    ],
  });
  try {
    if (!second.res.ok || !second.res.body) {
      return record(
        2,
        "Tool-call round trip",
        "FAIL",
        `tool result rejected: ${await failDetail(second.res)}`
      );
    }
    const s = await readStream(second.res);
    note(s);
    if (!s.text.trim()) {
      return record(
        2,
        "Tool-call round trip",
        "FAIL",
        `no final text after the tool result (finish_reason ${JSON.stringify(s.finishReason)})`
      );
    }
    record(
      2,
      "Tool-call round trip",
      "PASS",
      `called lookup_sprint(${call.args.slice(0, 40)}), answered "${s.text.trim().slice(0, 50)}"`
    );
  } finally {
    clearTimeout(second.timer);
  }
}

// ── 5. ~60 KB body ──────────────────────────────────────────────────────
async function checkLargeBody() {
  const line = "Filler line for the request-size probe; ignore it entirely.\n";
  const filler = line.repeat(Math.ceil(60_000 / line.length));
  const body = {
    model: MODEL,
    stream: true,
    max_tokens: 256,
    messages: [{ role: "user", content: `Reply with OK and nothing else.\n\n${filler}` }],
  };
  const size = Buffer.byteLength(JSON.stringify(body));
  // Only the status matters: stop reading once the headers are in.
  const controller = new AbortController();
  const { res, timer } = await post(body, controller);
  try {
    if (res.status === 413) {
      return record(
        5,
        "~60 KB request body",
        "FAIL",
        `413 for ${(size / 1024).toFixed(0)} KB — raise nginx client_max_body_size`
      );
    }
    if (!res.ok) return record(5, "~60 KB request body", "FAIL", await failDetail(res));
    record(5, "~60 KB request body", "PASS", `${(size / 1024).toFixed(0)} KB accepted (HTTP 200)`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function run(n, name, fn) {
  try {
    await fn();
  } catch (err) {
    const reason = err?.name === "AbortError" ? "timed out" : redact(err?.message ?? String(err));
    record(n, name, "FAIL", reason);
  }
}

console.log(`Probing ${URL_} with model ${MODEL} (X-Caller: agile-toolkit)…\n`);

await run(1, "Streaming text", checkStreaming);
await run(2, "Tool-call round trip", checkToolRoundTrip);
record(
  3,
  "reasoning_content deltas",
  "INFO",
  seen.reasoning ? "present (ignored for display)" : "not seen"
);
record(
  4,
  "usage chunk",
  "INFO",
  seen.usage
    ? `present, e.g. ${JSON.stringify(seen.usageSample).slice(0, 80)}`
    : "not seen — token metering will record nothing"
);
await run(5, "~60 KB request body", checkLargeBody);

results.sort((a, b) => a.n - b.n);
const nameW = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.n}  ${r.name.padEnd(nameW)}  ${r.status.padEnd(4)}  ${r.detail}`);
}

const mustPass = results.filter((r) => [1, 2, 5].includes(r.n));
const failed = mustPass.filter((r) => r.status !== "PASS");
console.log(
  failed.length === 0
    ? "\nAll required checks passed."
    : `\n${failed.length} required check(s) failed: ${failed.map((r) => r.n).join(", ")}.`
);
process.exit(failed.length === 0 ? 0 : 1);
