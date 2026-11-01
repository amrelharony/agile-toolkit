// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
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
 * Migrations 0027 and 0028 narrow the Realtime policy's visitor branch to
 * the app's own topic shape. The regex in the NEWEST migration that sets it
 * must admit exactly what `visitorChannelName()` produces for every visitor
 * tool, so adding a tool without a migration fails here, and every other
 * branch must stay as 0026 wrote it. 0028 added Kano, Buy-a-Feature and the
 * $100 Test; 0027 stays as it shipped.
 */

const dir = path.resolve(__dirname, "../../supabase/migrations");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

/** The SQL without comment lines (comments repeat the regex for readers). */
function statements(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/** Migrations that set the policy function's visitor regex, oldest first. */
const visitorMigrations = readdirSync(dir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort()
  .filter((f) => /topic ~ '\^visitor:/.test(statements(read(f))));
const newest = visitorMigrations.at(-1)!;

const sql0026 = read("0026_realtime_room_authorization.sql");
const sql0027 = read("0027_realtime_visitor_topic_shape.sql");
const sqlNewest = read(newest);

function visitorRegexSource(sql: string): string {
  const m = /topic ~ '([^']+)'/.exec(statements(sql));
  if (!m) throw new Error("no `topic ~ '…'` visitor branch");
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

const shape = (tools: readonly string[]) =>
  `^visitor:(${tools.join("|")}):[${VISITOR_CODE_ALPHABET}]{${VISITOR_CODE_LENGTH}}$`;

const NEW_IN_0028 = ["kano-model", "buy-a-feature", "hundred-dollar-test"] as const;

describe("the newest visitor-topic migration", () => {
  const source = visitorRegexSource(sqlNewest);
  const re = new RegExp(source);

  it("is 0028, after 0027", () => {
    expect(visitorMigrations).toEqual([
      "0027_realtime_visitor_topic_shape.sql",
      "0028_realtime_visitor_prioritize_tools.sql",
    ]);
    expect(newest).toBe("0028_realtime_visitor_prioritize_tools.sql");
  });

  it("is derived from VISITOR_TOOLS and VISITOR_CODE_ALPHABET", () => {
    expect(source).toBe(shape(VISITOR_TOOLS));
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
    ["a new tool's prefix", "visitor:kano-model2:ABCDEFGHJKMN"],
    ["a new tool's stem", "visitor:kano:ABCDEFGHJKMN"],
    ["a prioritize tool without rounds", "visitor:moscow:ABCDEFGHJKMN"],
    ["a lowercase code", "visitor:retro:abcdefghjkmn"],
    ["an 11-character code", "visitor:retro:ABCDEFGHJKM"],
    ["a 13-character code", "visitor:retro:ABCDEFGHJKMNP"],
    ["an ambiguous 0", "visitor:retro:ABCDEFGHJKM0"],
    ["an ambiguous O", "visitor:retro:ABCDEFGHJKMO"],
    ["an ambiguous 1", "visitor:retro:ABCDEFGHJKM1"],
    ["an ambiguous I", "visitor:retro:ABCDEFGHJKMI"],
    ["an ambiguous L", "visitor:retro:ABCDEFGHJKML"],
    ["a suffix", "visitor:hundred-dollar-test:ABCDEFGHJKMN:extra"],
    ["a trailing newline", "visitor:buy-a-feature:ABCDEFGHJKMN\n"],
    ["a prefix", "xvisitor:retro:ABCDEFGHJKMN"],
    ["no code", "visitor:retro:"],
    ["the bare prefix", "visitor:"],
    ["an owner room", "tool:retro:room:ABCDEFGHJKMN"],
    ["an empty topic", ""],
  ])("refuses %s", (_label, topic) => {
    expect(re.test(topic)).toBe(false);
  });

  it("keeps every other branch of 0026 and 0027 byte for byte", () => {
    expect(functionWithoutVisitorBranch(sqlNewest)).toBe(functionWithoutVisitorBranch(sql0027));
    expect(functionWithoutVisitorBranch(sqlNewest)).toBe(functionWithoutVisitorBranch(sql0026));
    expect(statements(sql0026)).toContain("topic like 'visitor:%'");
    expect(statements(sqlNewest)).not.toContain("topic like 'visitor:%'");
  });

  it("changes nothing from 0027 but the visitor line", () => {
    const fn = (sql: string) =>
      statements(sql.slice(sql.indexOf("create or replace function public.realtime_room_allowed")))
        .split("\n")
        .filter((l) => !/topic ~ '/.test(l));
    expect(fn(sqlNewest)).toEqual(fn(sql0027));
  });

  it("keeps the signature, the comment and the explicit grant", () => {
    const s = statements(sqlNewest).replace(/\s+/g, " ");
    expect(s).toContain(
      "create or replace function public.realtime_room_allowed(topic text) returns boolean language sql stable set search_path = '' as $$"
    );
    expect(tail(sqlNewest)).toBe(tail(sql0026));
    expect(s).toContain(
      "grant execute on function public.realtime_room_allowed(text) to anon, authenticated, service_role;"
    );
    // Nothing else: the policies stay as 0026 made them.
    expect(s).not.toMatch(/create policy|drop policy/);
  });
});

describe("migration 0027, as it shipped", () => {
  const re0027 = new RegExp(visitorRegexSource(sql0027));

  it("still lists only the tools it shipped with (a new tool gets a new migration)", () => {
    expect(visitorRegexSource(sql0027)).toBe(
      shape(VISITOR_TOOLS.filter((t) => !(NEW_IN_0028 as readonly string[]).includes(t)))
    );
  });

  it.each(NEW_IN_0028)("refuses %s's rooms, which 0028 admits", (tool) => {
    const name = visitorChannelName(tool, "ABCDEFGHJKMN")!;
    expect(re0027.test(name)).toBe(false);
    expect(new RegExp(visitorRegexSource(sqlNewest)).test(name)).toBe(true);
  });

  it("keeps every other branch of 0026 byte for byte", () => {
    expect(functionWithoutVisitorBranch(sql0027)).toBe(functionWithoutVisitorBranch(sql0026));
    expect(tail(sql0027)).toBe(tail(sql0026));
  });
});
