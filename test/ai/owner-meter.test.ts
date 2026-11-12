// @vitest-environment node
/**
 * The owner's tool AI limiter client (lib/ai/owner-meter.server.ts) and its
 * migration: it reads check_tool_ai_rate_limit's answer strictly and fails
 * closed on anything else, including a call that takes too long; the
 * migration keeps the table closed and the limits the route documents.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { meterOwner, parseOwnerMeterReply, recordOwnerTokens } from "@/lib/ai/owner-meter.server";

const REPLY = {
  allowed: true,
  daily: 1,
  daily_max: 300,
  weekly: 1,
  weekly_max: 1500,
  monthly: 1,
  monthly_max: 5000,
  id: "row-1",
};

describe("parseOwnerMeterReply", () => {
  it("reads a good answer", () => {
    expect(parseOwnerMeterReply(REPLY)).toEqual({
      allowed: true,
      daily: 1,
      dailyMax: 300,
      weekly: 1,
      weeklyMax: 1500,
      monthly: 1,
      monthlyMax: 5000,
      id: "row-1",
    });
    expect(parseOwnerMeterReply({ ...REPLY, allowed: false, id: null })?.id).toBeNull();
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      [],
      "x",
      { ...REPLY, allowed: 1 },
      { ...REPLY, daily: -1 },
      { ...REPLY, weekly_max: "9" },
    ]) {
      expect(parseOwnerMeterReply(bad)).toBeNull();
    }
  });
});

describe("meterOwner", () => {
  it("calls the RPC with the task and model", async () => {
    const calls: unknown[] = [];
    const client = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push([fn, args]);
        return { data: REPLY, error: null };
      },
    };
    expect((await meterOwner(client, "ai.suggest_options", "openclaw-flash"))?.allowed).toBe(true);
    expect(calls).toEqual([
      ["check_tool_ai_rate_limit", { p_task: "ai.suggest_options", p_model: "openclaw-flash" }],
    ]);
  });

  it("gives null for an error, a throw or a call that takes too long", async () => {
    expect(
      await meterOwner({ rpc: async () => ({ data: null, error: { code: "42883" } }) }, "t.x", "m")
    ).toBeNull();
    expect(
      await meterOwner(
        {
          rpc: () => {
            throw new Error("boom");
          },
        },
        "t.x",
        "m"
      )
    ).toBeNull();
    expect(await meterOwner({ rpc: () => new Promise(() => {}) }, "t.x", "m", 20)).toBeNull();
  });

  it("never throws when recording tokens fails", async () => {
    await expect(
      recordOwnerTokens({ rpc: async () => Promise.reject(new Error("down")) }, "row-1", 1, 2)
    ).resolves.toBeUndefined();
  });
});

describe("migration 0040", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/0040_tool_ai_rate_limit.sql"),
    "utf8"
  );
  const code = sql.replace(/--.*$/gm, "");

  it("keeps the table closed to the API roles, with RLS on", () => {
    expect(code).toMatch(/alter table public\.tool_ai_usage enable row level security;/);
    expect(code).toMatch(
      /revoke all on table public\.tool_ai_usage from public, anon, authenticated;/
    );
    expect(code).not.toMatch(/create policy/i);
  });

  it("lets only signed-in callers run the two functions, as security definer with an empty search path", () => {
    for (const fn of [
      "check_tool_ai_rate_limit(text, text)",
      "record_tool_ai_tokens(uuid, integer, integer)",
    ]) {
      expect(code).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(code).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    expect(code.match(/security definer/g)).toHaveLength(2);
    expect(code.match(/set search_path = ''/g)).toHaveLength(2);
    expect(code.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("sets the limits the route documents: 300 a day, 1,500 a week, 5,000 a month", () => {
    expect(code).toMatch(/v_daily_max\s+integer := 300;/);
    expect(code).toMatch(/v_weekly_max\s+integer := 1500;/);
    expect(code).toMatch(/v_monthly_max\s+integer := 5000;/);
  });

  it("stores no text: the task id, the model, the time and token counts only", () => {
    const table = /create table if not exists public\.tool_ai_usage \(([\s\S]*?)\);/.exec(code)![1];
    const columns = table
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(columns).toEqual([
      "id",
      "user_id",
      "created_at",
      "task",
      "model",
      "tokens_in",
      "tokens_out",
    ]);
  });
});
