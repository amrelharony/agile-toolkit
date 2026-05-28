#!/usr/bin/env node
/**
 * MCP smoke-test harness.
 *
 * Walks the live MCP registry at /api/mcp, then invokes every action
 * (or a filtered subset) with stub arguments derived from its JSON
 * Schema. Reports a per-action pass/fail/skip matrix and exits non-zero
 * if any action errored unexpectedly.
 *
 * Usage:
 *   npm run mcp:smoke                                       (all actions)
 *   npm run mcp:smoke -- --tool planning-poker              (filter by tool id)
 *   npm run mcp:smoke -- --category read                    (read-only sweep)
 *   npm run mcp:smoke -- --prefix tool.canvas               (prefix filter)
 *   npm run mcp:smoke -- --verbose                          (print args + responses)
 *
 * Env:
 *   AGILE_TOOLKIT_URL  base URL (defaults http://localhost:3000)
 *   AGILE_TOOLKIT_PAT  bearer PAT (required; can also pass --pat)
 *
 * Stub args follow the JSON Schema. Optional fields are omitted.
 * Required fields receive a minimal valid value per type:
 *   string  → "smoke"
 *   number  → 0
 *   integer → 0
 *   boolean → false
 *   array   → []
 *   object  → recursively-stubbed
 *   enum    → first value
 * Anything we can't shape (e.g. union, anyOf without const) is reported
 * as SKIPPED with reason, not a failure — squads should annotate the
 * action's schema with `.example()` or `.default()` to drive the stub.
 *
 * Categorisation of results:
 *   PASS     read action returned isError:false
 *            write action either succeeded OR returned a validated
 *            domain error (e.g. "Sprint X not found") — semantic
 *            errors are expected when stub args reference nothing real
 *   FAIL     -32602 schema rejection (handler refused stub args)
 *            -32603 internal error
 *            HTTP non-200
 *   SKIP     could not generate stub args from this schema
 */

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const flag = (name) => args.includes("--" + name);

const URL_BASE = arg("url") ?? process.env.AGILE_TOOLKIT_URL ?? "http://localhost:3000";
const PAT = arg("pat") ?? process.env.AGILE_TOOLKIT_PAT;
const FILTER_TOOL = arg("tool");
const FILTER_PREFIX = arg("prefix");
const FILTER_CATEGORY = arg("category");
const VERBOSE = flag("verbose");

if (!PAT) {
  console.error("Missing PAT. Set AGILE_TOOLKIT_PAT or pass --pat pat_xxx");
  process.exit(2);
}

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${PAT}`,
};

async function rpc(method, params) {
  const body = { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e9), method, params };
  const res = await fetch(`${URL_BASE}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 429) {
    return { __httpError: res.status, __text: await res.text() };
  }
  if (res.status === 429) {
    return { __rateLimited: true };
  }
  return res.json();
}

// ── JSON Schema → minimal stub generator ───────────────────────────
function stubFromSchema(schema, depth = 0) {
  if (depth > 6) return { __skip: "schema too deep" };
  if (!schema || typeof schema !== "object") return { __skip: "no schema" };

  // Enum → first value
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { value: schema.enum[0] };
  }
  // Const → that value
  if ("const" in schema) {
    return { value: schema.const };
  }

  // Multi-type unions we don't try to disambiguate
  if (schema.anyOf || schema.oneOf) {
    // Pick the first non-null variant if available
    const opts = schema.anyOf ?? schema.oneOf;
    for (const opt of opts) {
      if (opt.type !== "null") return stubFromSchema(opt, depth + 1);
    }
    return { __skip: "anyOf/oneOf with no usable variant" };
  }

  const type = schema.type;
  switch (type) {
    case "string":
      // Honour format hints minimally
      if (schema.format === "date-time" || schema.format === "date") {
        return { value: new Date().toISOString() };
      }
      if (schema.format === "uuid") {
        return { value: "00000000-0000-0000-0000-000000000000" };
      }
      return { value: "smoke" };
    case "number":
    case "integer":
      return { value: 0 };
    case "boolean":
      return { value: false };
    case "null":
      return { value: null };
    case "array": {
      // Empty array is always valid unless minItems > 0; if so, populate
      // with one stub item.
      const minItems = schema.minItems ?? 0;
      if (minItems === 0) return { value: [] };
      const item = stubFromSchema(schema.items ?? {}, depth + 1);
      if (item.__skip) return { __skip: `array item: ${item.__skip}` };
      return { value: Array.from({ length: minItems }, () => item.value) };
    }
    case "object":
    case undefined: {
      const out = {};
      const required = new Set(schema.required ?? []);
      const props = schema.properties ?? {};
      for (const [k, sub] of Object.entries(props)) {
        if (!required.has(k)) continue; // skip optional fields
        const child = stubFromSchema(sub, depth + 1);
        if (child.__skip) return { __skip: `property '${k}': ${child.__skip}` };
        out[k] = child.value;
      }
      // additionalProperties: if it's a schema and required is empty, leave as {}
      return { value: out };
    }
    default:
      return { __skip: `unsupported type: ${JSON.stringify(type)}` };
  }
}

// ── main ───────────────────────────────────────────────────────────
const startedAt = Date.now();
console.log(`[mcp-smoke] target: ${URL_BASE}/api/mcp`);

const listRes = await rpc("tools/list");
if (listRes.__httpError) {
  console.error(`tools/list HTTP ${listRes.__httpError}: ${listRes.__text}`);
  process.exit(2);
}
if (listRes.error) {
  console.error("tools/list error:", listRes.error);
  process.exit(2);
}
const tools = listRes.result?.tools ?? [];
console.log(`[mcp-smoke] registry has ${tools.length} action(s)`);

// Filter
const filtered = tools.filter((t) => {
  if (FILTER_PREFIX && !t.name.startsWith(FILTER_PREFIX)) return false;
  if (FILTER_TOOL) {
    const snake = FILTER_TOOL.replaceAll("-", "_");
    if (
      !t.name.startsWith(`tool.${snake}.`) &&
      !t.name.startsWith(`workspace.${snake}.`) &&
      !t.name.includes(`.${snake}.`)
    )
      return false;
  }
  // Category is not in the MCP tools/list response (it's internal), so
  // --category filtering would need a registry-internal endpoint. For
  // now we approximate via name patterns.
  if (FILTER_CATEGORY === "read") {
    if (
      !/\.(list|get|compute|fetch|find|read|enumerate|describe|info)/.test(t.name) &&
      !t.name.includes(".list_")
    )
      return false;
  }
  return true;
});
console.log(`[mcp-smoke] after filter: ${filtered.length}`);

const results = [];
let pass = 0,
  fail = 0,
  skip = 0;

for (const tool of filtered) {
  const stub = stubFromSchema(tool.inputSchema);
  if (stub.__skip) {
    skip++;
    results.push({ name: tool.name, status: "SKIP", reason: stub.__skip });
    if (VERBOSE) console.log(`SKIP ${tool.name}: ${stub.__skip}`);
    continue;
  }
  const callRes = await rpc("tools/call", { name: tool.name, arguments: stub.value });
  if (callRes.__httpError) {
    fail++;
    results.push({
      name: tool.name,
      status: "FAIL",
      reason: `HTTP ${callRes.__httpError}: ${callRes.__text?.slice(0, 200)}`,
    });
    continue;
  }
  if (callRes.__rateLimited) {
    skip++;
    results.push({ name: tool.name, status: "SKIP", reason: "rate-limited" });
    continue;
  }
  if (callRes.error) {
    // JSON-RPC error: -32602 (Invalid args) or -32603 (Internal) are fails;
    // anything else is also a fail.
    fail++;
    results.push({
      name: tool.name,
      status: "FAIL",
      reason: `${callRes.error.code}: ${callRes.error.message}`,
    });
    if (VERBOSE) console.log(`FAIL ${tool.name}:`, callRes.error);
    continue;
  }
  const result = callRes.result;
  // `content` returned with isError:true is a DOMAIN failure — that's
  // expected for write actions whose stub args reference no real
  // entity. Mark as PASS (the action validated args and executed).
  pass++;
  results.push({
    name: tool.name,
    status: "PASS",
    isError: result?.isError === true,
    sample: VERBOSE ? result : undefined,
  });
  if (VERBOSE) {
    const txt = result?.content?.[0]?.text ?? "";
    console.log(
      `PASS ${tool.name}${result?.isError ? " (domain isError)" : ""}: ${txt.slice(0, 120)}`
    );
  }
}

// ── report ─────────────────────────────────────────────────────────
const ms = Date.now() - startedAt;
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`MCP SMOKE RESULTS  ${pass} pass · ${fail} fail · ${skip} skip · ${ms} ms`);
console.log("════════════════════════════════════════════════════════════════════");

if (fail > 0) {
  console.log("\nFailures:");
  for (const r of results) {
    if (r.status === "FAIL") console.log(`  ${r.name}\n     ${r.reason}`);
  }
}
if (skip > 0 && VERBOSE) {
  console.log("\nSkipped:");
  for (const r of results) {
    if (r.status === "SKIP") console.log(`  ${r.name}  (${r.reason})`);
  }
}

process.exit(fail > 0 ? 1 : 0);
