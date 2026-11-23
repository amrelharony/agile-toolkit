// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NOT_IN_BROWSER,
  PACK_MAX_CHARS,
  REPLY_MAX_CHARS,
  SPLIT_ROUND,
  addReply,
  asyncDeckFor,
  asyncDeckProblem,
  asyncResults,
  asyncRevealSteps,
  asyncRoundProblem,
  asyncRoundSummary,
  cardCount,
  closeRound,
  encodePack,
  encodeReply,
  estimateLink,
  expireRound,
  findReplyCodes,
  hasNames,
  heldStoryIds,
  isReadyToReveal,
  keepUntil,
  needsTalk,
  newAsyncRound,
  packFor,
  readAsyncRound,
  readPack,
  readReply,
  replyClash,
  replyProblem,
  revealRound,
  validateReply,
  wellFormed,
  withStoryEstimate,
  type AsyncReplyCode,
} from "@/lib/estimation/async-pack";
import { toBase64Url } from "@/lib/realtime/vote-room/crypto";
import { POKER_ASYNC_MAX, type PokerAsyncRound } from "@/lib/stores/workspace-types";

/**
 * Estimate without a meeting: the link that carries a round's stories out,
 * the reply code that carries each person's cards back, and the round's
 * life on the host's page. Every read is hostile.
 */

const NOW = "2026-11-20T10:00:00.000Z";
const LATER = "2026-11-21T10:00:00.000Z";
const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_round000001",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: [...FIB],
    stories: [
      { id: "s1", title: "Pay by phone" },
      { id: "s2", title: "Refund a payment" },
      { id: "s3", title: "Save a card" },
    ],
    expected: ["Ana", "Bo"],
    dueDate: "2026-11-28",
    replies: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const target = (r: PokerAsyncRound) => ({ r: r.id, d: r.deck, s: r.stories.map((s) => s.title) });

/** A reply code as the estimator's page makes it. */
function reply(
  r: PokerAsyncRound,
  name: string,
  picks: (string | null)[],
  notes: { story: number; text: string }[] = []
): AsyncReplyCode {
  const v = validateReply(target(r), { name, picks, notes });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.values.reply;
}

const opts = (id = "rep_1", at = LATER) => ({ id, at });
const code = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
/** BMP text that costs 3 UTF-8 bytes a character. */
const cjk = (n: number) => "估".repeat(n);

describe("the pack", () => {
  it("round-trips a round's stories, deck, due day, host and meanings", () => {
    const r = round({ withMeanings: true });
    const meanings = FIB.map((c) => (c === "?" ? "" : `About ${c} days of work`));
    const pack = packFor(r, { host: "Priya", meanings });
    const encoded = encodePack(pack);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(readPack(`#estimate=${encoded.code}`)).toEqual(pack);
    expect(readPack(`estimate=${encoded.code}`)).toEqual(pack);
    expect(pack).toEqual({
      v: 1,
      r: r.id,
      t: "Checkout stories",
      h: "Priya",
      d: FIB,
      s: ["Pay by phone", "Refund a payment", "Save a card"],
      due: "2026-11-28",
      m: meanings,
    });
    expect(estimateLink(encoded.code, "https://x.test")).toBe(
      `https://x.test/planning-poker/estimate#estimate=${encoded.code}`
    );
  });

  it("leaves the meanings out unless the round asked for them, and never carries a reference story", () => {
    const pack = packFor(round(), { meanings: FIB.map(() => "A meaning") });
    expect(pack.m).toBeUndefined();
    expect(JSON.stringify(pack)).not.toMatch(/reference/i);
  });

  it("drops the meanings first, then refuses with 'Split into two rounds'", () => {
    // 20 stories at 100 Latin characters fit; meanings for 16 cards at 120 CJK don't.
    const deck = Array.from({ length: 16 }, (_, i) => String(i + 1));
    const stories = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      title: `Story ${i} `.padEnd(100, "x"),
    }));
    const r = round({ deck, stories, withMeanings: true });
    const fat = encodePack(packFor(r, { meanings: deck.map(() => cjk(120)) }));
    expect(fat).toMatchObject({ ok: true, meaningsDropped: true });
    if (fat.ok) {
      expect(fat.chars).toBeLessThanOrEqual(PACK_MAX_CHARS);
      expect(readPack(`#estimate=${fat.code}`)?.m).toBeUndefined();
    }
    // 20 stories at 120 CJK characters are over the cap on their own.
    const huge = round({ stories: stories.map((s) => ({ ...s, title: cjk(120) })) });
    expect(encodePack(packFor(huge))).toEqual({ ok: false, problem: SPLIT_ROUND });
  });

  it("refuses junk, wrong versions, unknown keys and anything over its cap", () => {
    const good = packFor(round());
    expect(readPack(`#estimate=${code(good)}`)).not.toBeNull();
    for (const bad of [
      null,
      42,
      "",
      "#estimate=",
      "#estimate=!!!",
      "#reply=abc",
      `#estimate=${"A".repeat(PACK_MAX_CHARS + 4)}`,
      `#estimate=${code("not an object")}`,
      `#estimate=${code([good])}`,
      `#estimate=${code({ ...good, v: 2 })}`,
      `#estimate=${code({ ...good, extra: 1 })}`,
      `#estimate=${code({ ...good, r: "round_1" })}`,
      `#estimate=${code({ ...good, t: "x".repeat(POKER_ASYNC_MAX.title + 1) })}`,
      `#estimate=${code({ ...good, s: [] })}`,
      `#estimate=${code({ ...good, s: Array(21).fill("A story") })}`,
      `#estimate=${code({ ...good, s: ["x".repeat(POKER_ASYNC_MAX.storyTitle + 1)] })}`,
      `#estimate=${code({ ...good, d: ["1"] })}`,
      `#estimate=${code({ ...good, d: ["1", "1"] })}`,
      `#estimate=${code({ ...good, d: ["?", "∞"] })}`,
      `#estimate=${code({ ...good, d: Array.from({ length: 17 }, (_, i) => String(i)) })}`,
      `#estimate=${code({ ...good, due: "2026-02-30" })}`,
      `#estimate=${code({ ...good, m: ["only one"] })}`,
      `#estimate=${code({ ...good, h: "" })}`,
    ]) {
      expect(readPack(bad), String(bad).slice(0, 60)).toBeNull();
    }
  });

  it("refuses hidden direction and control characters in any text", () => {
    const good = packFor(round());
    for (const t of ["Pay‮yb enohp", "Pay\u0000"]) {
      expect(readPack(`#estimate=${code({ ...good, t })}`)).toBeNull();
      expect(readPack(`#estimate=${code({ ...good, s: [t] })}`)).toBeNull();
      expect(readPack(`#estimate=${code({ ...good, h: t })}`)).toBeNull();
    }
  });
});

describe("the reply code", () => {
  it("round-trips a name, a card per story (or none) and notes", () => {
    const r = round();
    const made = validateReply(target(r), {
      name: "  Lee  Park ",
      picks: ["5", null, "?"],
      notes: [
        { story: 2, text: "Needs the bank's API" },
        { story: 0, text: "  " },
      ],
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.values.code.startsWith("AT1.")).toBe(true);
    expect(readReply(made.values.code)).toEqual({
      roundId: r.id,
      name: "Lee Park",
      cards: "3-7",
      notes: [{ story: 2, text: "Needs the bank's API" }],
    });
    // Inside a link, or with words around it.
    expect(readReply(`https://x.test/planning-poker#reply=${made.values.code}`)?.name).toBe(
      "Lee Park"
    );
    expect(findReplyCodes(`one ${made.values.code}\nthen ${made.values.code}`)).toHaveLength(2);
  });

  it("fits 20 cards, a 40-character name and 5 full notes in a non-Latin script", () => {
    const deck = Array.from({ length: 16 }, (_, i) => String(i + 1));
    const stories = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: `S${i}` }));
    const r = round({ deck, stories });
    const made = validateReply(target(r), {
      name: cjk(POKER_ASYNC_MAX.name),
      picks: stories.map(() => "16"),
      notes: [0, 4, 8, 12, 19].map((story) => ({ story, text: cjk(POKER_ASYNC_MAX.note) })),
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.values.code.length).toBeLessThanOrEqual(REPLY_MAX_CHARS);
    expect(readReply(made.values.code)?.notes).toHaveLength(5);
  });

  it("asks for a name, a card and at most five notes", () => {
    const r = round();
    const v = validateReply(target(r), {
      name: " ",
      picks: [null, null, null],
      notes: [0, 1, 2, 0, 1, 2].map((story) => ({ story, text: "x" })),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.name).toBeTruthy();
    expect(v.errors.cards).toBeTruthy();
    // Six notes on three stories are three notes, one per story.
    expect(v.errors.notes).toBeUndefined();
    const many = round({
      stories: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `S${i}` })),
    });
    const six = validateReply(target(many), {
      name: "Lee",
      picks: ["1", null, null, null, null, null],
      notes: Array.from({ length: 6 }, (_, story) => ({ story, text: "x" })),
    });
    expect(six.ok ? null : six.errors.notes).toBeTruthy();
    // A hidden direction character in a name is refused, not stored.
    const bidi = validateReply(target(r), { name: "Lee‮", picks: ["1"], notes: [] });
    expect(bidi.ok ? null : bidi.errors.name).toBeTruthy();
  });

  it("refuses junk, unknown keys and anything off its caps", () => {
    const good = { v: 1, r: "async_round000001", n: "Lee", e: "3-7", c: [[2, "Note"]] };
    expect(readReply(`AT1.${code(good)}`)).not.toBeNull();
    for (const bad of [
      null,
      7,
      "",
      "AT1.",
      "AT2.abc",
      "AT1.!!!",
      `AT1.${"A".repeat(REPLY_MAX_CHARS)}`,
      `AT1.${code("text")}`,
      `AT1.${code({ ...good, v: 2 })}`,
      `AT1.${code({ ...good, x: 1 })}`,
      `AT1.${code({ ...good, r: "nope" })}`,
      `AT1.${code({ ...good, n: "" })}`,
      `AT1.${code({ ...good, n: "x".repeat(POKER_ASYNC_MAX.name + 1) })}`,
      `AT1.${code({ ...good, n: "Lee‮" })}`,
      `AT1.${code({ ...good, e: "3g7" })}`,
      `AT1.${code({ ...good, e: "" })}`,
      `AT1.${code({ ...good, e: "0".repeat(21) })}`,
      `AT1.${code({ ...good, c: [[3, "Past the stories"]] })}`,
      `AT1.${code({ ...good, c: [[1.5, "Half"]] })}`,
      `AT1.${code({
        ...good,
        c: [
          [1, "a"],
          [1, "b"],
        ],
      })}`,
      `AT1.${code({ ...good, c: [[1, "x".repeat(POKER_ASYNC_MAX.note + 1)]] })}`,
      `AT1.${code({ ...good, c: [[1, "Line\u0007"]] })}`,
      `AT1.${code({ ...good, c: Array.from({ length: 6 }, () => [0, "x"]) })}`,
    ]) {
      expect(readReply(bad), String(bad).slice(0, 60)).toBeNull();
    }
  });

  it("drops lone surrogates before they reach a code", () => {
    expect(wellFormed("a\uD800b\uDC00c😀")).toBe("abc😀");
  });
});

describe("adding a reply to the host's round", () => {
  it("maps each card and note onto the round's stories", () => {
    const r = round();
    const next = addReply(
      r,
      reply(r, "Ana", ["5", "8", null], [{ story: 1, text: "Bank API" }]),
      "replace",
      opts()
    );
    expect(next.replies).toEqual([
      {
        id: "rep_1",
        name: "Ana",
        votes: [
          { storyId: "s1", card: "5" },
          { storyId: "s2", card: "8" },
        ],
        notes: [{ storyId: "s2", text: "Bank API" }],
        at: LATER,
      },
    ]);
    expect(next.updatedAt).toBe(LATER);
    expect(cardCount(next)).toBe(2);
  });

  it("refuses a reply for another round, a closed one, or one off the round's stories or deck", () => {
    const r = round();
    const ok = reply(r, "Ana", ["5", "8", "3"]);
    expect(replyProblem(ok, r)).toBeNull();
    expect(replyProblem(ok, undefined)).toBe(NOT_IN_BROWSER);
    expect(replyProblem(ok, round({ id: "async_another0001" }))).toBe(NOT_IN_BROWSER);
    expect(replyProblem(ok, round({ status: "closed" }))).toMatch(/closed/);
    expect(replyProblem({ ...ok, cards: "55" }, r)).toMatch(/doesn't match/);
    // "f" is the 16th card; this deck has 9.
    expect(replyProblem({ ...ok, cards: "5f3" }, r)).toMatch(/isn't on the deck/);
    expect(replyProblem({ ...ok, cards: "---" }, r)).toMatch(/no cards/);
    // addReply never stores what replyProblem refuses.
    expect(addReply(r, { ...ok, cards: "5f3" }, "replace", opts())).toBe(r);
  });

  it("asks before a reply under a name already in: replace it, or keep both as 'Lee (2)'", () => {
    const r0 = round();
    const r1 = addReply(r0, reply(r0, "Lee", ["1", "2", "3"]), "replace", opts("rep_1"));
    const again = reply(r0, "lee", ["5", "5", "5"]);
    expect(replyClash(again, r1)?.id).toBe("rep_1");
    expect(replyClash(reply(r0, "Ana", ["1", null, null]), r1)).toBeNull();

    const replaced = addReply(r1, again, "replace", opts("rep_2"));
    expect(replaced.replies.map((x) => [x.id, x.name])).toEqual([["rep_2", "lee"]]);

    const both = addReply(r1, again, "keep-both", opts("rep_2"));
    expect(both.replies.map((x) => x.name)).toEqual(["Lee", "lee (2)"]);
    const three = addReply(both, reply(r0, "Lee", ["1", "1", "1"]), "keep-both", opts("rep_3"));
    expect(three.replies.map((x) => x.name)).toEqual(["Lee", "lee (2)", "Lee (3)"]);
    // A long name still fits its cap with the number on it.
    const long = "L".repeat(POKER_ASYNC_MAX.name);
    const l1 = addReply(r0, reply(r0, long, ["1", null, null]), "replace", opts("a"));
    const l2 = addReply(l1, reply(r0, long, ["2", null, null]), "keep-both", opts("b"));
    expect(l2.replies[1].name.length).toBe(POKER_ASYNC_MAX.name);
    expect(l2.replies[1].name.endsWith(" (2)")).toBe(true);
  });

  it("holds at most 20 replies, but a replacement still goes in", () => {
    let r = round();
    for (let i = 0; i < POKER_ASYNC_MAX.replies; i++) {
      r = addReply(r, reply(r, `P${i}`, ["1", null, null]), "replace", opts(`r${i}`));
    }
    expect(r.replies).toHaveLength(20);
    expect(replyProblem(reply(r, "New", ["1", null, null]), r)).toMatch(/20 replies/);
    const swapped = addReply(r, reply(r, "P3", ["8", null, null]), "replace", opts("swap"));
    expect(swapped.replies).toHaveLength(20);
    expect(swapped.replies.find((x) => x.name === "P3")?.votes[0].card).toBe("8");
  });
});

describe("closing and expiry", () => {
  const withReplies = () => {
    const r = round();
    const a = addReply(
      r,
      reply(r, "Ana", ["5", "8", null], [{ story: 1, text: "Bank" }]),
      "replace",
      opts("a")
    );
    return addReply(a, reply(r, "Bo", ["3", "8", "2"]), "replace", opts("b"));
  };

  it("close drops names, notes and the expected list, and keeps the votes", () => {
    const closed = closeRound(revealRound(withReplies(), LATER), LATER);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBe(LATER);
    expect(closed.expected).toBeUndefined();
    expect(closed.replies.map((x) => x.name)).toEqual(["", ""]);
    expect(closed.replies.every((x) => x.notes === undefined)).toBe(true);
    expect(closed.replies.map((x) => x.votes.length)).toEqual([2, 3]);
    expect(hasNames(closed)).toBe(false);
    expect(JSON.stringify(closed)).not.toMatch(/Ana|Bo|Bank/);
  });

  it("drops them 14 days after the due day, or after the day it was made", () => {
    const r = withReplies();
    expect(keepUntil(r)).toBe("2026-12-12");
    expect(expireRound(r, LATER, "2026-12-12")).toBe(r);
    const gone = expireRound(r, LATER, "2026-12-13");
    expect(gone.status).toBe("closed");
    expect(hasNames(gone)).toBe(false);

    const undated = { ...r, dueDate: undefined };
    expect(keepUntil(undated)).toBe("2026-12-04");
    expect(readAsyncRound(undated, new Date("2026-12-10T12:00:00")).status).toBe("closed");
    expect(readAsyncRound(r, new Date("2026-11-25T12:00:00"))).toBe(r);
  });

  it("holds the queue stories of open and revealed rounds only", () => {
    expect(
      heldStoryIds([
        round({ id: "async_aaaa", stories: [{ id: "q1", title: "A" }] }),
        round({ id: "async_bbbb", status: "revealed", stories: [{ id: "q2", title: "B" }] }),
        round({ id: "async_cccc", status: "closed", stories: [{ id: "q3", title: "C" }] }),
      ])
    ).toEqual(["q1", "q2"]);
    expect(heldStoryIds(undefined)).toEqual([]);
  });

  it("records an agreed card on the round's story, and takes it back", () => {
    const r = round({ stories: [{ id: "s1", title: "A", discuss: true }] });
    const agreed = withStoryEstimate(r, "s1", "5", LATER);
    expect(agreed.stories[0]).toEqual({ id: "s1", title: "A", finalEstimate: "5", discuss: false });
    expect(
      withStoryEstimate(agreed, "s1", undefined, LATER).stories[0].finalEstimate
    ).toBeUndefined();
    expect(withStoryEstimate(r, "nope", "5", LATER)).toBe(r);
  });
});

describe("results after Reveal", () => {
  it("sorts each story's votes low to high, with the verdict and the notes", () => {
    let r = round();
    r = addReply(
      r,
      reply(r, "Ana", ["8", "5", null], [{ story: 0, text: "Big" }]),
      "replace",
      opts("a")
    );
    r = addReply(r, reply(r, "Bo", ["3", "5", "?"]), "replace", opts("b"));
    r = addReply(r, reply(r, "Cy", ["13", "5", null]), "replace", opts("c"));
    const [one, two, three] = asyncResults(r);
    expect(one.votes).toEqual([
      { name: "Bo", card: "3" },
      { name: "Ana", card: "8" },
      { name: "Cy", card: "13" },
    ]);
    expect(one.tone).toBe("spread");
    expect(one.notes).toEqual([{ name: "Ana", text: "Big" }]);
    expect(needsTalk(one)).toBe(true);
    expect(two.label).toBe("Full consensus");
    expect(two.verdict).toBe("Everyone played 5.");
    expect(needsTalk(two)).toBe(false);
    expect(three.consensus.level).toBeNull();
    expect(needsTalk(three)).toBe(true);
  });

  it("gives Amr counts and verdicts only: no name, note or anyone's card", () => {
    let r = round();
    r = addReply(
      r,
      reply(r, "Ana", ["8", "5", "1"], [{ story: 0, text: "Secret" }]),
      "replace",
      opts("a")
    );
    const open = asyncRoundSummary(r);
    expect(open).toMatchObject({ replyCount: 1, expectedCount: 2, storyCount: 3, stories: null });
    const shown = asyncRoundSummary(revealRound(r, LATER));
    expect(shown.stories?.[0]).toMatchObject({ title: "Pay by phone", label: "One estimate" });
    for (const s of [open, shown]) expect(JSON.stringify(s)).not.toMatch(/Ana|Bo|Secret/);
  });
});

describe("the next step", () => {
  const replied = (r: PokerAsyncRound, names: string[]) =>
    names.reduce(
      (acc, n, i) => addReply(acc, reply(acc, n, ["1", null, null]), "replace", opts(`r${i}`)),
      r
    );

  it("says to reveal a round whose due day has passed or whose expected people all replied", () => {
    const due = replied(round({ id: "async_due00001" }), ["Ana"]);
    expect(isReadyToReveal(due, "2026-11-28")).toBe(false);
    expect(asyncRevealSteps([due], "2026-11-29")).toEqual([
      {
        id: "poker-async-reveal-async_due00001",
        label: "Reveal “Checkout stories”: 1 of 2 replied",
        detail: "Its due day has passed. Reveal the cards you have.",
        href: "/planning-poker",
      },
    ]);
    const all = replied(round({ id: "async_all00001" }), ["Ana", "bo"]);
    expect(asyncRevealSteps([all], "2026-11-21")[0].label).toBe(
      "Reveal “Checkout stories”: 2 of 2 replied"
    );
  });

  it("stays quiet with no replies, for example, revealed or expired rounds", () => {
    expect(asyncRevealSteps([round()], "2026-11-30")).toEqual([]);
    const r = replied(round(), ["Ana", "Bo"]);
    expect(asyncRevealSteps([{ ...r, id: "example-async" }], "2026-11-30")).toEqual([]);
    expect(asyncRevealSteps([revealRound(r, LATER)], "2026-11-30")).toEqual([]);
    expect(asyncRevealSteps([r], "2026-12-30")).toEqual([]);
    expect(asyncRevealSteps(undefined, "2026-11-30")).toEqual([]);
  });
});

describe("a new round", () => {
  const input = {
    title: "Checkout",
    scaleType: "fibonacci" as const,
    deck: asyncDeckFor("fibonacci"),
    stories: [{ id: "s1", title: "Pay by phone" }],
    expected: ["Ana", "ana", "Bo"],
    dueDate: "2026-11-28",
  };

  it("checks the title, deck, stories, names and due day", () => {
    expect(asyncRoundProblem(input, "2026-11-20")).toBeNull();
    expect(asyncRoundProblem({ ...input, title: " " }, "2026-11-20")).toMatch(/Name/);
    expect(asyncRoundProblem({ ...input, stories: [] }, "2026-11-20")).toMatch(/at least one/);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, title: "A" }));
    expect(asyncRoundProblem({ ...input, stories: many }, "2026-11-20")).toMatch(/Split/);
    expect(asyncRoundProblem({ ...input, dueDate: "2026-11-19" }, "2026-11-20")).toMatch(/later/);
    expect(asyncRoundProblem({ ...input, dueDate: "soon" }, "2026-11-20")).toMatch(/due day/);
    expect(asyncDeckProblem(Array.from({ length: 17 }, (_, i) => String(i)))).toMatch(/16/);
    expect(asyncDeckProblem(asyncDeckFor("custom", "1, 2, 2"))).toMatch(/twice/);
    expect(asyncDeckProblem(asyncDeckFor("tshirt"))).toBeNull();
  });

  it("starts open with no replies, each expected name once", () => {
    const r = newAsyncRound(input, "async_new000001", NOW);
    expect(r).toEqual({
      id: "async_new000001",
      title: "Checkout",
      scaleType: "fibonacci",
      deck: FIB,
      stories: [{ id: "s1", title: "Pay by phone" }],
      expected: ["Ana", "Bo"],
      dueDate: "2026-11-28",
      replies: [],
      status: "open",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("makes a reply code the page can read back for the same round", () => {
    const r = newAsyncRound(input, "async_new000001", NOW);
    const c = encodeReply({ roundId: r.id, name: "Lee", cards: "4", notes: [] });
    const read = readReply(c);
    expect(read && replyProblem(read, r)).toBeNull();
  });
});
