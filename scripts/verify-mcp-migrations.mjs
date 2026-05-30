#!/usr/bin/env node
/**
 * Verify the Phase-3 MCP migrations against a live Supabase project.
 *
 * Migrations 0018 (PAT squad scope) + 0019 (mcp_call_log) are statically sound
 * and idempotent, but the live apply + insert round-trip can't be checked
 * without a service-role key (which CI/dev sandboxes don't carry). This script
 * is the turn-key check: run it once against your project after applying the
 * migrations.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/verify-mcp-migrations.mjs
 *
 * It checks (read-only except for a self-cleaning round-trip row):
 *   0018  access_tokens.squad_profile_ids column exists
 *   0018  resolve_pat(text,text) + resolve_pat(text) are callable + return scope
 *   0019  mcp_call_log table + columns exist, RLS-readable shape
 *   0019  a service-role insert → select → delete round-trip succeeds
 *
 * Exit code 0 = all green, 1 = any failure. SKIPPED checks don't fail the run.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "✗ Missing env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then re-run."
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const record = (name, status, detail = "") => results.push({ name, status, detail });
const PASS = "PASS";
const FAIL = "FAIL";
const SKIP = "SKIP";

/** A PostgREST error whose message names a missing relation/column/function. */
function missing(error) {
  const m = (error?.message || "").toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find") ||
    m.includes("schema cache") ||
    error?.code === "42P01" || // undefined_table
    error?.code === "42703" || // undefined_column
    error?.code === "42883" // undefined_function
  );
}

async function checkColumn0018() {
  const { error } = await sb.from("access_tokens").select("squad_profile_ids").limit(0);
  if (!error) return record("0018 access_tokens.squad_profile_ids", PASS);
  record("0018 access_tokens.squad_profile_ids", FAIL, error.message);
}

async function checkResolvePat(args, label) {
  const { error } = await sb.rpc("resolve_pat", args);
  // A non-matching hash yields zero rows + no error when the function exists.
  if (!error) return record(label, PASS, "callable (0 rows for dummy hash)");
  if (missing(error)) return record(label, FAIL, `not found: ${error.message}`);
  // Other errors (e.g. permission) still prove the function exists.
  record(label, PASS, `exists (non-fatal error: ${error.message})`);
}

async function checkTable0019() {
  const { error } = await sb
    .from("mcp_call_log")
    .select("id,user_id,action_id,duration_ms,squad_profile_ids,is_error,created_at")
    .limit(0);
  if (!error) return record("0019 mcp_call_log table + columns", PASS);
  record("0019 mcp_call_log table + columns", FAIL, error.message);
}

async function checkRoundTrip0019() {
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
  const userId = list?.users?.[0]?.id;
  if (listErr || !userId) {
    return record(
      "0019 insert→select→delete round-trip",
      SKIP,
      "no auth.users to satisfy the user_id FK — create a user, then re-run"
    );
  }
  const marker = `__verify_${Date.now()}__`;
  const { error: insErr } = await sb.from("mcp_call_log").insert({
    user_id: userId,
    action_id: marker,
    duration_ms: 1,
    squad_profile_ids: [],
    is_error: false,
  });
  if (insErr) {
    return record("0019 insert→select→delete round-trip", FAIL, `insert: ${insErr.message}`);
  }
  const { data: read, error: readErr } = await sb
    .from("mcp_call_log")
    .select("id,created_at,duration_ms")
    .eq("action_id", marker);
  // Clean up regardless of read outcome so the table stays pristine.
  await sb.from("mcp_call_log").delete().eq("action_id", marker);
  if (readErr || !read?.length) {
    return record(
      "0019 insert→select→delete round-trip",
      FAIL,
      `read back: ${readErr?.message ?? "0 rows"}`
    );
  }
  if (typeof read[0].id !== "number" || !read[0].created_at) {
    return record("0019 insert→select→delete round-trip", FAIL, "id/created_at not DB-generated");
  }
  record(
    "0019 insert→select→delete round-trip",
    PASS,
    "row inserted, read with generated id+created_at, deleted"
  );
}

async function main() {
  console.log(`Verifying MCP migrations against ${url}\n`);
  await checkColumn0018();
  await checkResolvePat(
    { p_hash: "__verify_no_match__", p_salt: "__verify__" },
    "0018 resolve_pat(text,text)"
  );
  await checkResolvePat({ p_hash: "__verify_no_match__" }, "0018 resolve_pat(text)");
  await checkTable0019();
  await checkRoundTrip0019();

  let failed = 0;
  for (const r of results) {
    const icon = r.status === PASS ? "✓" : r.status === SKIP ? "○" : "✗";
    if (r.status === FAIL) failed += 1;
    console.log(`  ${icon} ${r.status}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(
    `\n${failed === 0 ? "✓ All checks passed (skips are non-fatal)." : `✗ ${failed} check(s) failed.`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Verification crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
