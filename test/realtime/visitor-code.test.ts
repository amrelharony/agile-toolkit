import { describe, expect, it } from "vitest";
import {
  NEVER_IN_CODE,
  codeCharacters,
  groupRoomCode,
  joinInputMessage,
  readJoinInput,
  type JoinInput,
} from "@/lib/realtime/visitor-code";
import {
  VISITOR_CODE_ALPHABET,
  VISITOR_CODE_LENGTH,
  VISITOR_TOOLS,
  isVisitorRoomCode,
} from "@/lib/realtime/visitor-rooms";

/**
 * The 12-character code as people see it (ABCD-EFGH-JKMN) and type it at
 * /join: any case, spaces, dashes, full-width characters, or the whole link.
 * The alphabet has neither half of a look-alike pair, so 0/O and 1/I/L are
 * never mapped: the box says to look again.
 */

const CODE = "ABCD2345EFGH";
const FP = "abcdefghijklmnopqrstuv";

/** A small seeded generator, so the property cases are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomCode(next: () => number): string {
  let out = "";
  for (let i = 0; i < VISITOR_CODE_LENGTH; i++) {
    out += VISITOR_CODE_ALPHABET[Math.floor(next() * VISITOR_CODE_ALPHABET.length)];
  }
  return out;
}

/** The code as someone might type it: case, separators, spaces, full-width. */
function messUp(code: string, next: () => number): string {
  const seps = ["", " ", "-", "  ", " - ", "–", "—", ".", "_", "·", "/"];
  let out = "";
  for (let i = 0; i < code.length; i++) {
    let ch = code[i];
    if (next() < 0.5) ch = ch.toLowerCase();
    if (next() < 0.15) ch = String.fromCharCode(ch.charCodeAt(0) + 0xfee0); // full-width
    out += ch;
    if (i < code.length - 1 && (i % 4 === 3 || next() < 0.1)) {
      out += seps[Math.floor(next() * seps.length)];
    }
  }
  return `${next() < 0.5 ? " " : ""}${out}${next() < 0.5 ? "\n" : ""}`;
}

function ok(input: JoinInput): Extract<JoinInput, { ok: true }> {
  if (!input.ok) throw new Error(`expected ok, got ${input.problem}`);
  return input;
}

function bad(input: JoinInput): Extract<JoinInput, { ok: false }> {
  if (input.ok) throw new Error(`expected a problem, got ${input.code}`);
  return input;
}

describe("groupRoomCode", () => {
  it("shows a code in three groups of four", () => {
    expect(groupRoomCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(groupRoomCode(CODE)).toBe("ABCD-2345-EFGH");
  });

  it("leaves anything that isn't a code as it was", () => {
    expect(groupRoomCode("ABC234")).toBe("ABC234");
    expect(groupRoomCode("abcdefghjkmn")).toBe("abcdefghjkmn");
  });

  it("round-trips: the grouped code reads back as the code", () => {
    const next = rng(7);
    for (let i = 0; i < 50; i++) {
      const code = randomCode(next);
      expect(ok(readJoinInput(groupRoomCode(code))).code).toBe(code);
    }
  });
});

describe("readJoinInput: a bare code", () => {
  it("accepts any case, spacing, dashes and full-width characters (300 random codes)", () => {
    const next = rng(42);
    for (let i = 0; i < 300; i++) {
      const code = randomCode(next);
      const typed = messUp(code, next);
      const got = ok(readJoinInput(typed));
      expect(got.code, JSON.stringify(typed)).toBe(code);
      expect(got.tool).toBeNull();
      expect(got.keyFragment).toBeNull();
      expect(isVisitorRoomCode(got.code)).toBe(true);
    }
  });

  it("normalises to the alphabet's characters only", () => {
    expect(codeCharacters(" ab cd-2345·efgh ")).toBe(CODE);
    expect(codeCharacters("ＡＢＣＤ２３４５ＥＦＧＨ")).toBe(CODE);
  });

  it("never maps a look-alike: 0, O, 1, I and L aren't in the alphabet at all", () => {
    for (const ch of NEVER_IN_CODE) expect(VISITOR_CODE_ALPHABET.includes(ch)).toBe(false);
    for (const [typed, chars] of [
      ["ABCD-2345-EFG0", ["0"]],
      ["abcd-2345-efgo", ["O"]],
      ["ABCD-2345-EFG1", ["1"]],
      ["ABCD-2345-EFGi", ["I"]],
      ["ABCD-2345-EFGl", ["L"]],
      ["oOo0-2345-EFGH", ["O", "0"]],
    ] as const) {
      const got = bad(readJoinInput(typed));
      expect(got.problem, typed).toBe("look-alike");
      expect(got.chars).toEqual(chars);
      expect(joinInputMessage(got)).toMatch(/never use 0, O, 1, I or L/);
    }
  });

  it("says when it's too short or too long, with the count", () => {
    const short = bad(readJoinInput("ABCD-2345-EF"));
    expect(short).toMatchObject({ problem: "too-short", length: 10 });
    expect(joinInputMessage(short)).toBe("That's 10 characters. A room code has 12.");
    const long = bad(readJoinInput("ABCD-2345-EFGH-J"));
    expect(long).toMatchObject({ problem: "too-long", length: 13 });
  });

  it("refuses characters a code never has, naming them", () => {
    const got = bad(readJoinInput("ABCD#2345!EFGH"));
    expect(got.problem).toBe("not-a-code");
    expect(got.chars).toEqual(["#", "!"]);
    expect(joinInputMessage(got)).toBe(
      'A room code has no "#" or "!". Codes use letters and the digits 2 to 9.'
    );
  });

  it("asks for a code when nothing was typed", () => {
    for (const blank of ["", "   ", " - - "]) {
      expect(bad(readJoinInput(blank)).problem).toBe("empty");
    }
  });
});

describe("readJoinInput: a pasted link", () => {
  it("keeps the tool and the host's key from the link's channel", () => {
    for (const tool of VISITOR_TOOLS) {
      const got = ok(readJoinInput(`https://example.test/join/${tool}/${CODE}#k=${FP}`));
      expect(got).toEqual({ ok: true, code: CODE, tool, keyFragment: `#k=${FP}` });
    }
  });

  it("takes a path without the origin, a lower-case code or a trailing slash", () => {
    expect(ok(readJoinInput(`/join/retro/${CODE.toLowerCase()}/`))).toMatchObject({
      code: CODE,
      tool: "retro",
      keyFragment: null,
    });
    expect(ok(readJoinInput(`  see /join/quick-vote/${CODE}#k=${FP} thanks`))).toMatchObject({
      tool: "quick-vote",
      keyFragment: `#k=${FP}`,
    });
  });

  it("refuses a link to a tool without a live room", () => {
    const got = bad(readJoinInput(`https://example.test/join/kanban/${CODE}`));
    expect(got.problem).toBe("unknown-tool");
  });

  it("checks the link's code like a typed one", () => {
    expect(bad(readJoinInput(`/join/retro/ABCD0000EFGH`)).problem).toBe("look-alike");
  });
});
