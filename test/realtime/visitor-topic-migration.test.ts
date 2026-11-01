// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VISITOR_CODE_ALPHABET,
  VISITOR_CODE_LENGTH,
  VISITOR_TOOLS,
  newVisitorRoomCode,
  visitorChannelName,
} from "@/lib/realtime/visitor-rooms";

/**
 * Migration 0027 narrows the Realtime policy's visitor branch to the app's
 * own topic shape. The regex in the SQL must admit exactly what
 * `visitorChannelName()` produces for every visitor tool, so adding a tool
 * without a migration fails here, and every other branch must stay as 0026
 * wrote it.
 */

const dir = path.resolve(__dirname, "../../supabase/migrations");
const sql0026 = readFileSync(path.join(dir, "0026_realtime_room_authorization.sql"), "utf8");
const sql0027 = readFileSync(path.join(dir, "0027_realtime_visitor_topic_shape.sql"), "utf8");

/** The SQL without comment lines (comments repeat the regex for readers). */
function statements(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function visitorRegexSource(): string {
  const m = /topic ~ '([^']+)'/.exec(statements(sql0027));
  if (!m) throw new Error("0027 has no `topic ~ '…'` visitor branch");
  return m[1];
}

/** The function block (create … $$;) with the visitor branch and its comment lines cut out. */
function functionWithoutVisitorBranch(sql: string): string {
  const start = sql.indexOf("create or replace function public.realtime_room_allowed");
  const end = sql.indexOf("$$;", start) + 3;
  const lines = sql.slice(start, end).split(/\r?\n/);
  const from = lines.findIndex((l) => l.trim().startsWith("-- Visitor rooms:"));
  const to = lines.findIndex((l) => /topic (like 'visitor:%'|~ ')/.test(l));
  if (from < 0 || to < from) throw new Error("no visitor branch found");
  return [...lines.slice(0, from), ...lines.slice(to + 1)].join("\n");
}

function tail(sql: string): string {
  // `comment on function …` and the grant, as statements.
  return statements(sql)
    .slice(statements(sql).indexOf("comment on function public.realtime_room_allowed"))
    .split("grant execute on function public.realtime_room_allowed(text)")
    .map((s) => s.split(";")[0])
    .join("|");
}

describe("migration 0027 (visitor topic shape)", () => {
  const source = visitorRegexSource();
  const re = new RegExp(source);

  it("is derived from VISITOR_TOOLS and VISITOR_CODE_ALPHABET", () => {
    expect(source).toBe(
      `^visitor:(${VISITOR_TOOLS.join("|")}):[${VISITOR_CODE_ALPHABET}]{${VISITOR_CODE_LENGTH}}$`
    );
  });

  it("admits every channel the app opens, for every visitor tool", () => {
    for (const tool of VISITOR_TOOLS) {
      for (let i = 0; i < 100; i++) {
        const name = visitorChannelName(tool, newVisitorRoomCode());
        expect(name).not.toBeNull();
        expect(re.test(name!)).toBe(true);
      }
      // Every symbol of the alphabet, in every position class.
      const all = VISITOR_CODE_ALPHABET.repeat(2);
      for (let s = 0; s + VISITOR_CODE_LENGTH <= all.length; s++) {
        expect(re.test(visitorChannelName(tool, all.slice(s, s + VISITOR_CODE_LENGTH))!)).toBe(
          true
        );
      }
    }
  });

  it.each([
    ["another tool", "visitor:canvas:ABCDEFGHJKMN"],
    ["a tool prefix", "visitor:retro2:ABCDEFGHJKMN"],
    ["a lowercase code", "visitor:retro:abcdefghjkmn"],
    ["an 11-character code", "visitor:retro:ABCDEFGHJKM"],
    ["a 13-character code", "visitor:retro:ABCDEFGHJKMNP"],
    ["an ambiguous 0", "visitor:retro:ABCDEFGHJKM0"],
    ["an ambiguous O", "visitor:retro:ABCDEFGHJKMO"],
    ["an ambiguous 1", "visitor:retro:ABCDEFGHJKM1"],
    ["an ambiguous I", "visitor:retro:ABCDEFGHJKMI"],
    ["an ambiguous L", "visitor:retro:ABCDEFGHJKML"],
    ["a suffix", "visitor:retro:ABCDEFGHJKMN:extra"],
    ["a trailing newline", "visitor:retro:ABCDEFGHJKMN\n"],
    ["a prefix", "xvisitor:retro:ABCDEFGHJKMN"],
    ["no code", "visitor:retro:"],
    ["the bare prefix", "visitor:"],
    ["an owner room", "tool:retro:room:ABCDEFGHJKMN"],
    ["an empty topic", ""],
  ])("refuses %s", (_label, topic) => {
    expect(re.test(topic)).toBe(false);
  });

  it("keeps every other branch of 0026 byte for byte", () => {
    expect(functionWithoutVisitorBranch(sql0027)).toBe(functionWithoutVisitorBranch(sql0026));
    expect(statements(sql0026)).toContain("topic like 'visitor:%'");
    expect(statements(sql0027)).not.toContain("topic like 'visitor:%'");
  });

  it("keeps the signature, the comment and the explicit grant", () => {
    const s = statements(sql0027).replace(/\s+/g, " ");
    expect(s).toContain(
      "create or replace function public.realtime_room_allowed(topic text) returns boolean language sql stable set search_path = '' as $$"
    );
    expect(tail(sql0027)).toBe(tail(sql0026));
    expect(s).toContain(
      "grant execute on function public.realtime_room_allowed(text) to anon, authenticated, service_role;"
    );
    // Nothing else: the policies stay as 0026 made them.
    expect(s).not.toMatch(/create policy|drop policy/);
  });
});
