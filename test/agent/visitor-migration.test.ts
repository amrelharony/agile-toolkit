// @vitest-environment node
/**
 * Migration 0037 (the visitor AI meter): closed to the public API, the meter
 * callable by the service role only, nothing that identifies a visitor, the
 * plan's limits as the defaults, the meter's checks and counts as the plan
 * has them, housekeeping that runs whatever the answer, and safe to run twice.
 *
 * These read the SQL as text (there is no Postgres in the test run), so each
 * check pins the exact expression a limit depends on: an edit that changes
 * what a limit means has to change a test too.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PEAK } from "@/lib/visitor-ai/peak";

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0037_visitor_ai_usage.sql"),
  "utf8"
);
const statements = sql.replace(/--.*$/gm, "");
const TABLES = ["visitor_ai_usage", "visitor_ai_daily", "visitor_ai_hourly", "visitor_ai_config"];

/** One function's body, between its `as $$` and the `$$;` that closes it. */
function functionBody(name: string): string {
  const start = statements.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = statements.indexOf("as $$", start);
  const close = statements.indexOf("\n$$;", open);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return statements.slice(open + "as $$".length, close);
}

const meter = functionBody("visitor_ai_meter");
const housekeeping = functionBody("visitor_ai_housekeeping");
/** Whitespace folded, so a check doesn't depend on line breaks. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("migration 0037", () => {
  it("is closed to the public API, with the meter for the service role only", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security;`)
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${table}\\s+from public, anon, authenticated;`)
      );
    }
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/grant\s+(select|insert|update|delete|all)/i);
    expect(sql).toMatch(
      /revoke all on function public\.visitor_ai_meter\(text, boolean\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.visitor_ai_meter(text, boolean) to service_role;"
    );
    // Housekeeping is internal: revoked from every API role and granted to none.
    expect(sql).toMatch(
      /revoke all on function public\.visitor_ai_housekeeping\(\)\s+from public, anon, authenticated;/
    );
    expect(statements.match(/grant execute/g)).toHaveLength(1);
  });

  it("runs both functions with an empty search path and every table schema-qualified", () => {
    expect(flat(statements)).toContain(
      "returns jsonb language plpgsql security definer set search_path = ''"
    );
    expect(flat(statements)).toContain("returns void language plpgsql set search_path = ''");
    for (const body of [meter, housekeeping]) {
      // (`v_…` are the functions' own variables: `select … into v_cfg`, `extract(hour from v_local)`.)
      for (const m of Array.from(
        body.matchAll(/\b(?:from|into|update|join)\s+(?!v_|set\b)([a-z_.]+)/gi)
      )) {
        expect(m[1]).toMatch(/^public\./);
      }
    }
  });

  it("stores a daily code, never an address or message text", () => {
    expect(sql).toContain(
      "visitor_key text not null check (visitor_key ~ '^[A-Za-z0-9_-]{16,64}$')"
    );
    // The table comments say what isn't kept; the statements must not keep it.
    const code = statements.replace(/comment on table[\s\S]*?';/g, "");
    expect(code).not.toMatch(/\b(ip|ip_address|inet|user_agent|cookie|message|content)\b/i);
  });

  it("counts by the Cairo day, and the peak window in its own zone", () => {
    expect(sql).toContain("(now() at time zone 'Africa/Cairo')::date");
    expect(meter).toContain("v_now at time zone v_cfg.peak_tz");
    expect(meter).toContain("extract(isodow from v_local)::int = any (v_cfg.peak_days)");
  });

  it("takes the peak hours as [peak_start, peak_end) in peak_tz, and ends the window at peak_end", () => {
    // 14:00 is in the window and 18:00 is not.
    expect(meter).toContain("extract(hour from v_local)::int >= v_cfg.peak_start");
    expect(meter).toContain("extract(hour from v_local)::int < v_cfg.peak_end");
    expect(meter).not.toMatch(/<=\s*v_cfg\.peak_end/);
    expect(flat(meter)).toContain(
      "v_peak_end := (date_trunc('day', v_local) + make_interval(hours => v_cfg.peak_end)) at time zone v_cfg.peak_tz;"
    );
  });

  it("has the same default peak window as the panel's note (DEFAULT_PEAK)", () => {
    const column = (name: string) =>
      new RegExp(`\\n\\s+${name}\\s+[a-z\\[\\]]+ not null default ('[^']*'|\\d+)`).exec(sql)?.[1];
    expect(column("peak_tz")).toBe(`'${DEFAULT_PEAK.tz}'`);
    expect(column("peak_days")).toBe(`'{${DEFAULT_PEAK.days.join(",")}}'`);
    expect(column("peak_start")).toBe(String(DEFAULT_PEAK.start));
    expect(column("peak_end")).toBe(String(DEFAULT_PEAK.end));
  });

  it("locks the day row before the visitor row", () => {
    const day = meter.indexOf("from public.visitor_ai_daily where day = v_day for update");
    const visitor = meter.indexOf("where day = v_day and visitor_key = p_visitor for update");
    expect(day).toBeGreaterThan(0);
    expect(visitor).toBeGreaterThan(day);
  });

  it("looks without locks first, and counts only after a second look under the locks", () => {
    // The first look: plain selects that create nothing.
    expect(meter).toMatch(
      /select \* into v_daily from public\.visitor_ai_daily where day = v_day;/
    );
    expect(flat(meter)).toContain(
      "select * into v_usage from public.visitor_ai_usage where day = v_day and visitor_key = p_visitor;"
    );
    // A refusal on the first look returns before any lock; an allowance goes round again.
    expect(meter).toContain("exit when v_reason is not null or v_locked;");
    const loopEnd = meter.indexOf("end loop;");
    const count = meter.indexOf("update public.visitor_ai_usage");
    expect(loopEnd).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(loopEnd);
    expect(meter.slice(loopEnd)).toContain("if v_reason is null then");
  });

  it("refuses in the plan's order", () => {
    const order = [
      "'disabled'",
      "'visitor_limit'",
      "'visitor_peak_limit'",
      "'site_limit'",
      "'site_peak_limit'",
      "'site_busy'",
    ].map((code) => meter.indexOf(code));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("applies the message limits to a new turn only, and the call caps to every call", () => {
    const checks = flat(meter);
    expect(checks).toContain(
      "if v_new_turn and v_usage.turns >= v_cfg.turns_per_visitor then v_reason := 'visitor_limit';"
    );
    expect(checks).toContain(
      "elsif v_new_turn and v_peak and v_usage.peak_turns >= v_cfg.peak_turns_per_visitor then v_reason := 'visitor_peak_limit';"
    );
    expect(checks).toContain(
      "elsif v_new_turn and v_daily.turns >= v_cfg.turns_per_day then v_reason := 'site_limit';"
    );
    expect(checks).toContain(
      "elsif v_new_turn and v_peak and v_daily.peak_turns >= v_cfg.peak_turns_per_day then v_reason := 'site_peak_limit';"
    );
    // No guard on the call caps: a tool round is a call like any other.
    expect(checks).toContain(
      "elsif v_usage.calls >= v_cfg.calls_per_visitor or v_daily.calls >= v_cfg.calls_per_day or v_5h >= v_cfg.calls_per_5h then v_reason := 'site_busy';"
    );
  });

  it("counts a tool round as a call but not a message", () => {
    const counts = flat(meter.slice(meter.indexOf("if v_reason is null then")));
    // Both the visitor's row and the day's: turns and peak turns only on a new turn, calls always.
    expect(
      counts.match(/turns = turns \+ \(case when v_new_turn then 1 else 0 end\)/g)
    ).toHaveLength(2);
    expect(
      counts.match(
        /peak_turns = peak_turns \+ \(case when v_new_turn and v_peak then 1 else 0 end\)/g
      )
    ).toHaveLength(2);
    expect(counts.match(/calls = calls \+ 1\b/g)).toHaveLength(2);
    expect(counts).toContain(
      "insert into public.visitor_ai_hourly as h (hour, calls) values (v_hour, 1) on conflict (hour) do update set calls = h.calls + 1;"
    );
    expect(counts).not.toMatch(/turns = turns \+ 1\b/);
  });

  it("sums at least the last 5 hours of calls for the 5-hour cap", () => {
    expect(flat(meter)).toContain(
      "select coalesce(sum(calls), 0) into v_5h from public.visitor_ai_hourly where hour >= v_hour - interval '5 hours';"
    );
    expect(meter).not.toMatch(/hour > v_hour - interval '5 hours'/);
    // Kept long enough for that sum: 6 hours back plus the current bucket.
    expect(housekeeping).toContain(
      "delete from public.visitor_ai_hourly where hour < v_hour - interval '6 hours';"
    );
  });

  it("keeps visitor codes for today only, hourly counts 6 hours and daily totals 30 days", () => {
    expect(housekeeping).toContain("delete from public.visitor_ai_usage where day < v_day;");
    expect(housekeeping).toContain("delete from public.visitor_ai_daily where day < v_day - 30;");
    expect(sql).not.toContain("v_day - 1");
    // The meter itself deletes nothing: it all goes through housekeeping.
    expect(meter).not.toMatch(/\bdelete\b/i);
  });

  it("runs housekeeping before anything can return, the brake included, and before any lock", () => {
    const housekeep = meter.indexOf("perform public.visitor_ai_housekeeping();");
    expect(housekeep).toBeGreaterThan(0);
    expect(housekeep).toBeLessThan(meter.indexOf("if not found or not v_cfg.enabled then"));
    expect(housekeep).toBeLessThan(meter.indexOf("for update"));
    expect(meter.slice(0, housekeep)).not.toMatch(/\breturn\b/);
  });

  it("never lets housekeeping hold a request up", () => {
    // One call at a time does it; the rest skip it.
    expect(housekeeping).toContain(
      "if not pg_try_advisory_xact_lock(hashtext('public.visitor_ai_housekeeping')) then"
    );
    // A row still in use is left for next time, after at most 200 ms.
    expect(flat(statements)).toContain(
      "returns void language plpgsql set search_path = '' set lock_timeout = '200ms'"
    );
    expect(flat(housekeeping)).toContain("exception when lock_not_available then null;");
  });

  it("schedules housekeeping hourly with pg_cron where it is installed, and never fails without it", () => {
    const block = flat(statements.slice(statements.lastIndexOf("do $$")));
    expect(block).toContain(
      "if exists (select 1 from pg_extension where extname = 'pg_cron') then"
    );
    expect(block).toContain(
      "perform cron.unschedule(jobid) from cron.job where jobname = 'visitor_ai_housekeeping_hourly';"
    );
    expect(block).toContain(
      "perform cron.schedule( 'visitor_ai_housekeeping_hourly', '7 * * * *', $cmd$ select public.visitor_ai_housekeeping() $cmd$ );"
    );
    expect(block).toContain(
      "exception when undefined_table or undefined_function or insufficient_privilege or invalid_schema_name then"
    );
  });

  it("defaults to the plan's limits and peak window", () => {
    const defaults: Record<string, string> = {
      enabled: "true",
      turns_per_visitor: "100",
      peak_turns_per_visitor: "25",
      turns_per_day: "20000",
      peak_turns_per_day: "2000",
      calls_per_visitor: "300",
      calls_per_day: "60000",
      calls_per_5h: "6000",
      reasoning_effort: "'high'",
      peak_tz: "'Asia/Singapore'",
      peak_days: "'{1,2,3,4,5}'",
      peak_start: "14",
      peak_end: "18",
    };
    for (const [column, value] of Object.entries(defaults)) {
      expect(sql).toMatch(
        new RegExp(
          `\\n\\s+${column}\\s+[a-z\\[\\]]+ not null default ${value.replace(/[{}]/g, "\\$&")}`
        )
      );
    }
    expect(sql).toContain("check (reasoning_effort in ('low', 'high', 'max'))");
  });

  it("is safe to run twice", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
    expect(sql).toContain(
      "insert into public.visitor_ai_config (id) values (true) on conflict (id) do nothing;"
    );
    expect(sql).toContain("create or replace function public.visitor_ai_meter");
    expect(sql).toContain("create or replace function public.visitor_ai_housekeeping");
  });
});
