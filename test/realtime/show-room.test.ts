import { describe, expect, it } from "vitest";
import {
  SHOW_LIMITS,
  SHOW_ROOM_EVENTS,
  SHOW_ROOM_TOOLS,
  readShowHere,
  readShowState,
  showControlInput,
  showStateInput,
  type ShowStateBody,
} from "@/lib/realtime/show-room/protocol";
import {
  TEXT_FRAME_KIND,
  encodeShowPayload,
  parseShowPayload,
  parseTextFrame,
  showFrameKinds,
  showFrameParser,
  textFrame,
} from "@/lib/realtime/show-room/frames";
import {
  TextFrameView,
  registerShowRenderer,
  showRendererFor,
} from "@/lib/realtime/show-room/renderers";
import { VISITOR_ROOM_KIND } from "@/lib/realtime/visitor-rooms";
import { signedJoinUrl } from "@/lib/realtime/signed-room";

/**
 * Show rooms' wire protocol, frame parsers and renderer registry: readers
 * accept exactly what a host builds; a payload goes through its tool's
 * parser on both ends; an unknown kind has no parser and no renderer.
 */

const HOST = "host_00000000000";
const KEYS = { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` };
const SIG = "s".repeat(86);

function body(o: Partial<ShowStateBody> = {}): ShowStateBody {
  return {
    v: 1,
    by: HOST,
    seq: 1,
    tool: "picker",
    endsAt: Date.now() + 3_600_000,
    keys: KEYS,
    here: 0,
    frame: null,
    ...o,
  };
}
const wire = (b: object) => JSON.parse(JSON.stringify({ ...b, sig: SIG })) as unknown;

describe("show tools", () => {
  it("are exactly the visitor tools whose room kind is show", () => {
    expect([...SHOW_ROOM_TOOLS]).toEqual(
      Object.entries(VISITOR_ROOM_KIND)
        .filter(([, k]) => k === "show")
        .map(([t]) => t)
    );
  });
});

describe("readShowState", () => {
  it("accepts exactly what the host builds, with or without a frame", () => {
    const empty = body();
    expect(readShowState(wire(empty), "picker")).toEqual({ ...empty, sig: SIG });
    const withFrame = body({
      seq: 4,
      here: 3,
      frame: { n: 2, kind: "text", data: '{"title":"Sam","body":""}', at: 1_000 },
    });
    expect(readShowState(wire(withFrame), "picker")).toEqual({ ...withFrame, sig: SIG });
  });

  it.each<[string, object]>([
    ["another tool", { tool: "team-mixer" }],
    ["a wrong version", { v: 2 }],
    ["a bad sender", { by: "short" }],
    ["a negative seq", { seq: -1 }],
    ["more here than seats", { here: 21 }],
    ["a frame kind with capitals", { frame: { n: 1, kind: "Text", data: "{}", at: 1 } }],
    ["frame number 0", { frame: { n: 0, kind: "text", data: "{}", at: 1 } }],
    [
      "a payload over the cap",
      { frame: { n: 1, kind: "text", data: "x".repeat(SHOW_LIMITS.maxPayloadChars + 1), at: 1 } },
    ],
    ["a short key", { keys: { sig: "A".repeat(86), ecdh: KEYS.ecdh } }],
  ])("refuses %s", (_label, over) => {
    expect(readShowState(wire(body(over)), "picker")).toBeNull();
  });

  it("refuses a state without a signature, or over the size cap", () => {
    expect(readShowState(JSON.parse(JSON.stringify(body())), "picker")).toBeNull();
    expect(
      readShowState(wire({ ...body(), pad: "x".repeat(SHOW_LIMITS.maxStateChars) }), "picker")
    ).toBeNull();
  });

  it("drops unknown fields", () => {
    const read = readShowState(wire({ ...body(), extra: 1 }), "picker");
    expect(read).not.toHaveProperty("extra");
  });
});

describe("signing", () => {
  it("covers the frame's exact text and the here count, under the show domain", () => {
    const a = showStateInput(
      body({ frame: { n: 1, kind: "text", data: '{"title":"A","body":""}', at: 5 } })
    );
    const b = showStateInput(
      body({ frame: { n: 1, kind: "text", data: '{"title":"B","body":""}', at: 5 } })
    );
    expect(a).not.toBe(b);
    expect(JSON.parse(a)[0]).toBe("agile-toolkit:show-room:v1");
    expect(showStateInput(body({ here: 1 }))).not.toBe(showStateInput(body({ here: 2 })));
    const kick = showControlInput(SHOW_ROOM_EVENTS.kick, { v: 1, by: HOST, id: HOST });
    const end = showControlInput(SHOW_ROOM_EVENTS.end, { v: 1, by: HOST, reason: "host" });
    expect(JSON.parse(kick)[0]).toBe("agile-toolkit:show-room:v1");
    expect(kick).not.toBe(end);
  });

  it("reads a participant's I'm here and nothing more", () => {
    expect(readShowHere({ v: 1, by: "alice_0000000000", here: true })).toEqual({
      v: 1,
      by: "alice_0000000000",
      here: true,
    });
    expect(readShowHere({ v: 1, by: "alice_0000000000", here: "yes" })).toBeNull();
    expect(readShowHere({ v: 1, by: "bad", here: true })).toBeNull();
  });

  it("builds the join link with the host key's fingerprint", () => {
    expect(signedJoinUrl("picker", "ABCDEFGHJKMN", "abcdefghijklmnopqrstuv")).toBe(
      "/join/picker/ABCDEFGHJKMN#k=abcdefghijklmnopqrstuv"
    );
    expect(signedJoinUrl("picker", "ABCDEFGHJKMN", "short")).toBeNull();
    expect(signedJoinUrl("picker", "abc", "abcdefghijklmnopqrstuv")).toBeNull();
  });
});

describe("frame parsers", () => {
  it("give every show tool the text frame", () => {
    for (const tool of SHOW_ROOM_TOOLS) {
      expect(showFrameKinds(tool)).toContain(TEXT_FRAME_KIND);
      expect(showFrameParser(tool, "text")).toBe(parseTextFrame);
    }
  });

  it("parse a text frame only when it is clean", () => {
    expect(parseTextFrame({ title: "Sam", body: "picked" })).toEqual({
      title: "Sam",
      body: "picked",
    });
    expect(parseTextFrame({ title: "Sam" })).toEqual({ title: "Sam", body: "" });
    expect(parseTextFrame({ title: "" })).toBeNull();
    expect(parseTextFrame({ title: "Sam‮" })).toBeNull();
    expect(parseTextFrame({ title: "  Sam  " })).toBeNull();
    expect(parseTextFrame({ title: "x".repeat(121) })).toBeNull();
    expect(parseTextFrame("Sam")).toBeNull();
    expect(textFrame("  Sam  ", " picked ")).toEqual({ title: "Sam", body: "picked" });
    expect(textFrame("  ")).toBeNull();
  });

  it("refuse an unknown kind on both ends", () => {
    expect(showFrameParser("picker", "spin-wheel-9")).toBeNull();
    expect(showFrameParser("picker", "__proto__")).toBeNull();
    expect(showFrameParser("retro", "text")).toBeNull();
    expect(encodeShowPayload("picker", "bogus", { title: "x" })).toBeNull();
    expect(parseShowPayload("picker", "bogus", '{"title":"x"}')).toBeNull();
  });

  it("send the parser's version of a payload, and read it back the same", () => {
    const data = encodeShowPayload("card-decks", "text", { title: "Card", body: "Ask why", x: 1 });
    expect(data).toBe('{"title":"Card","body":"Ask why"}');
    expect(parseShowPayload("card-decks", "text", data)).toEqual({
      title: "Card",
      body: "Ask why",
    });
    expect(parseShowPayload("card-decks", "text", "not json")).toBeNull();
    expect(encodeShowPayload("card-decks", "text", { title: "" })).toBeNull();
  });
});

describe("renderer registry", () => {
  it("draws text for every show tool, and nothing for an unknown kind", () => {
    for (const tool of SHOW_ROOM_TOOLS) expect(showRendererFor(tool, "text")).not.toBeNull();
    expect(showRendererFor("picker", "spin")).toBeNull();
    expect(showRendererFor("retro", "text")).toBeNull();
  });

  it("adds a renderer at run time and takes it out again", () => {
    const off = registerShowRenderer("picker", "spin", TextFrameView as never);
    expect(showRendererFor("picker", "spin")).toBe(TextFrameView);
    expect(showRendererFor("team-mixer", "spin")).toBeNull();
    off();
    expect(showRendererFor("picker", "spin")).toBeNull();
    // A malformed kind is never registered.
    registerShowRenderer("picker", "Bad Kind", TextFrameView as never)();
    expect(showRendererFor("picker", "Bad Kind")).toBeNull();
  });
});
