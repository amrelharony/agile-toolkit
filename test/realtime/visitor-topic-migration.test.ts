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
 * Migrations from 0027 on narrow the Realtime policy's visitor branch to
 * the app's own topic shape. The regex in the NEWEST migration that defines
 * `realtime_room_allowed` with a visitor regex must list exactly
 * `VISITOR_TOOLS`, in order, and admit exactly what `visitorChannelName()`
 * produces for every visitor tool, so adding a tool without a migration
 * fails here. Every other branch must stay as 0026 wrote it.
 *
 * The newest migration is found by its content, not its file name: a
 * phase's migration is numbered when it merges. Each one only adds tools at
 * the end of the list before it, so the migrations shipped earlier (0027,
 * 0028, …) stay valid as they shipped.
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

/** The tools a visitor regex lists, in its order. */
function regexTools(sql: string): string[] {
  const m = /^\^visitor:\(([^)]+)\):/.exec(visitorRegexSource(sql));
  if (!m) throw new Error("the visitor regex lists no tools");
  return m[1].split("|");
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

describe("the newest visitor-topic migration", () => {
  const source = visitorRegexSource(sqlNewest);
  const re = new RegExp(source);

  it("comes after 0027, which started the narrowing", () => {
    expect(visitorMigrations[0]).toBe("0027_realtime_visitor_topic_shape.sql");
    expect(visitorMigrations.length).toBeGreaterThanOrEqual(2);
    expect(newest > "0027").toBe(true);
  });

  it("lists exactly VISITOR_TOOLS, in order, with the 12-character code shape", () => {
    expect(regexTools(sqlNewest)).toEqual([...VISITOR_TOOLS]);
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
    ["a show tool's stem", "visitor:pick:ABCDEFGHJKMN"],
    ["a wall tool's prefix", "visitor:audience-wall2:ABCDEFGHJKMN"],
    ["a tool joined to another", "visitor:picker|retro:ABCDEFGHJKMN"],
    ["a lowercase code", "visitor:retro:abcdefghjkmn"],
    ["an 11-character code", "visitor:retro:ABCDEFGHJKM"],
    ["a 13-character code", "visitor:retro:ABCDEFGHJKMNP"],
    ["a 13-character code on a new tool", "visitor:quick-vote:ABCDEFGHJKMNP"],
    ["an ambiguous 0", "visitor:retro:ABCDEFGHJKM0"],
    ["an ambiguous O", "visitor:retro:ABCDEFGHJKMO"],
    ["an ambiguous 1", "visitor:retro:ABCDEFGHJKM1"],
    ["an ambiguous I", "visitor:retro:ABCDEFGHJKMI"],
    ["an ambiguous L", "visitor:retro:ABCDEFGHJKML"],
    ["a suffix", "visitor:hundred-dollar-test:ABCDEFGHJKMN:extra"],
    ["a suffix on a new tool", "visitor:card-decks:ABCDEFGHJKMN:extra"],
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

describe("every visitor-topic migration, as it shipped", () => {
  const lists = visitorMigrations.map((f) => ({ file: f, tools: regexTools(read(f)) }));

  it("lists a growing prefix of VISITOR_TOOLS: a new tool gets a new migration, at the end", () => {
    let before = 0;
    for (const { file, tools } of lists) {
      expect(tools, file).toEqual(VISITOR_TOOLS.slice(0, tools.length));
      expect(tools.length, file).toBeGreaterThan(before);
      before = tools.length;
    }
  });

  it("keeps the 12-character code shape and every other branch of 0026 in each", () => {
    for (const { file, tools } of lists) {
      const sql = read(file);
      expect(visitorRegexSource(sql), file).toBe(shape(tools));
      expect(functionWithoutVisitorBranch(sql), file).toBe(functionWithoutVisitorBranch(sql0026));
      expect(tail(sql), file).toBe(tail(sql0026));
    }
  });

  it("refuses, in each earlier migration, the rooms of tools a later one admits", () => {
    const newestRe = new RegExp(visitorRegexSource(sqlNewest));
    for (const { file, tools } of lists.slice(0, -1)) {
      const re = new RegExp(visitorRegexSource(read(file)));
      for (const tool of VISITOR_TOOLS.slice(tools.length)) {
        const name = visitorChannelName(tool, "ABCDEFGHJKMN")!;
        expect(re.test(name), `${file} ${tool}`).toBe(false);
        expect(newestRe.test(name), tool).toBe(true);
      }
    }
  });

  it("0027 still lists only the tools it shipped with", () => {
    expect(regexTools(sql0027)).toEqual([
      "planning-poker",
      "retro",
      "health-check",
      "psych-safety",
      "mood-tracker",
    ]);
  });
});
