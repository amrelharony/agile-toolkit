import { describe, expect, it } from "vitest";
import {
  LEAD_MAX,
  chatView,
  createChatView,
  findLead,
  leadOf,
  type BalloonItem,
  type ChatItem,
  type StepsItem,
} from "@/lib/agent/chat-view";
import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

/**
 * The chat as the comic strip draws it: the lead rule (DNA-SPEC section 5),
 * and the store's messages as view items (you captions, balloons, one step
 * caption per run of tool calls). The rendered strip is checked in
 * chat-items.test.tsx.
 */

const AT = "2026-11-12T09:00:00Z";

const user = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const assistant = (id: string, ...content: ContentBlock[]): ChatMessage => ({
  id,
  role: "assistant",
  content,
  createdAt: AT,
});
const toolMsg = (id: string, ...content: ToolResultBlock[]): ChatMessage => ({
  id,
  role: "tool",
  content,
  createdAt: AT,
});
const text = (t: string): ContentBlock => ({ type: "text", text: t });
const call = (id: string, input: Record<string, unknown> = { text: "flaky CI" }): ToolUseBlock => ({
  type: "tool_use",
  id,
  name: "tool_retro_add_card",
  input,
});
const result = (callId: string, content = '{"added":true}'): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: callId,
  content,
});

const balloons = (items: readonly ChatItem[]) =>
  items.filter((i): i is BalloonItem => i.kind === "balloon");
const kinds = (items: readonly ChatItem[]) => items.map((i) => i.kind);

/** A string of `n` characters of plain Latin words, with no sentence end. */
const words = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

describe("findLead: which replies open with a lettered lead", () => {
  it("letters a short first sentence, and only it", () => {
    expect(leadOf("Here's how to run a retro. Open the board first.")).toBe(
      "Here's how to run a retro."
    );
    expect(leadOf("Done! The card is on the board.")).toBe("Done!");
    expect(leadOf("Want me to add it? Say the word.")).toBe("Want me to add it?");
    expect(leadOf("Sure thing.")).toBe("Sure thing.");
  });

  it("gives the position of the cut, after any leading spaces", () => {
    const reply = "\n  Added it. Anything else?";
    expect(findLead(reply)).toEqual({ state: "lead", start: 3, end: 12 });
    expect(reply.slice(3, 12)).toBe("Added it.");
  });

  it("ends the lead at a line break", () => {
    expect(leadOf("Here are the steps.\n\n1. Open the board")).toBe("Here are the steps.");
    expect(leadOf("Done.\nThe card is in Went well.")).toBe("Done.");
  });

  it("keeps closing quotes, brackets and emphasis with the lead", () => {
    expect(leadOf('He wrote "flaky CI." Then he left.')).toBe('He wrote "flaky CI."');
    expect(leadOf("**All set.** The retro is open.")).toBe("**All set.**");
    expect(leadOf("(It saves as you type.) Carry on.")).toBe("(It saves as you type.)");
  });

  it("has no lead when the first sentence runs past LEAD_MAX", () => {
    const long = `${words(LEAD_MAX + 10)}. Short one.`;
    expect(findLead(long)).toEqual({ state: "none" });
    // Never the second sentence instead.
    expect(leadOf(long)).toBeNull();
  });

  it("takes a sentence that ends exactly at LEAD_MAX, and none a character later", () => {
    const fits = `${words(LEAD_MAX - 1)}.`;
    expect(fits).toHaveLength(LEAD_MAX);
    expect(leadOf(`${fits} Next.`)).toBe(fits);
    expect(leadOf(`${words(LEAD_MAX)}. Next.`)).toBeNull();
    // A closing mark that runs past it takes the lead away too.
    expect(leadOf(`*${words(LEAD_MAX - 2)}.* Next.`)).toBeNull();
  });

  it("has no lead for a 400-character opening, with or without a period later on", () => {
    expect(leadOf(`${words(400)}. Then a short one.`)).toBeNull();
    expect(leadOf(`${words(200)}. ${words(200)}`)).toBeNull();
    expect(leadOf(words(400))).toBeNull();
  });

  it("has no lead when the reply opens with a list", () => {
    expect(leadOf("- Open the board. Then add a card.")).toBeNull();
    expect(leadOf("1. Open the board.\n2. Add a card.")).toBeNull();
    expect(leadOf("* One.\n* Two.")).toBeNull();
  });

  it("has no lead when the reply opens with a table", () => {
    expect(leadOf("| Tool | Use |\n|---|---|\n| Retro | Look back. |")).toBeNull();
    expect(leadOf("Tool | Use\n--- | ---\nRetro | Look back.")).toBeNull();
    // A pipe before the first sentence end reads as a table row.
    expect(leadOf("Pick one | or the other.")).toBeNull();
  });

  it("has no lead when the reply opens with code, a heading, a quote or a rule", () => {
    expect(leadOf("```ts\nconst a = 1;\n```\nThat sets it.")).toBeNull();
    expect(leadOf("## Steps\nOpen the board.")).toBeNull();
    expect(leadOf("> Quoted. Then more.")).toBeNull();
    expect(leadOf("---\nAfter the rule.")).toBeNull();
  });

  it("does not end a sentence at e.g., i.e., Mr. or other abbreviations", () => {
    expect(leadOf("Pick a format, e.g. a table. Then fill it in.")).toBe(
      "Pick a format, e.g. a table."
    );
    expect(leadOf("Use the board (i.e. the retro one). Then vote.")).toBe(
      "Use the board (i.e. the retro one)."
    );
    expect(leadOf("Ask Mr. Smith first. He owns it.")).toBe("Ask Mr. Smith first.");
    expect(leadOf("Talk to J. Smith now. He knows.")).toBe("Talk to J. Smith now.");
    expect(leadOf("Bring pens, notes, etc. to the room. Then start.")).toBe(
      "Bring pens, notes, etc. to the room."
    );
    expect(leadOf("Item No. 5 is open. Close it.")).toBe("Item No. 5 is open.");
    // "e.g." with nothing after it in a finished reply ends nothing.
    expect(leadOf("Use a tool, e.g.")).toBeNull();
  });

  it("does not end a sentence at a period in a number, a web address or a file name", () => {
    expect(leadOf("Velocity is 3.5 points a day. That's steady.")).toBe(
      "Velocity is 3.5 points a day."
    );
    expect(leadOf("See agile.org for more. Or ask.")).toBe("See agile.org for more.");
    expect(leadOf("Open README.md first. Then run it.")).toBe("Open README.md first.");
  });

  it("ends a sentence at the period after a number, a version or a web address", () => {
    expect(leadOf("The answer is 42. Next question.")).toBe("The answer is 42.");
    expect(leadOf("Update to v1.2. It fixes the board.")).toBe("Update to v1.2.");
    expect(leadOf("Read more at agile.org. Then come back.")).toBe("Read more at agile.org.");
  });

  it("does not end a sentence before a lower-case word or at an ellipsis", () => {
    expect(leadOf("Hmm... let me check. Done.")).toBe("Hmm... let me check.");
    expect(leadOf("Wait. then go. Now.")).toBe("Wait. then go.");
  });

  it("has no lead when the first line has no sentence end", () => {
    expect(leadOf("Here's how to run it:\n\n1. Open the board")).toBeNull();
    expect(leadOf("Sure thing")).toBeNull();
    expect(leadOf("Done...")).toBeNull();
  });

  it("has no lead for an Arabic or other non-Latin opening", () => {
    expect(leadOf("مرحبا. كيف أساعدك؟")).toBeNull();
    expect(leadOf("Hello مرحبا. More.")).toBeNull();
    expect(leadOf("Привет. Как дела?")).toBeNull();
    expect(leadOf("你好。我们开始吧。")).toBeNull();
  });

  it("has no lead without a letter, or with inline markdown left open across the cut", () => {
    expect(leadOf("2 + 2 = 4.")).toBeNull();
    expect(leadOf("42!")).toBeNull();
    // The code span holds the period, so the lead runs to the next sentence end.
    expect(leadOf("Run `make. Then` first. Then push.")).toBe("Run `make. Then` first.");
    expect(leadOf("Say *done. Then* go. Next.")).toBe("Say *done. Then* go.");
    // An inline code chip in the lead stays whole.
    expect(leadOf("Use `retro` here. It works.")).toBe("Use `retro` here.");
    expect(leadOf("See [the board](/retro). Then vote.")).toBe("See [the board](/retro).");
  });

  it("has none for an empty reply, and can't tell for one still empty while it streams", () => {
    expect(findLead("")).toEqual({ state: "none" });
    expect(findLead("  \n ")).toEqual({ state: "none" });
    expect(findLead("", true)).toEqual({ state: "open" });
  });

  it("waits while a streamed sentence end could still be something else", () => {
    expect(findLead("Done.", true)).toEqual({ state: "open" });
    expect(findLead("Done. ", true)).toEqual({ state: "open" });
    expect(findLead("Velocity is 3", true)).toEqual({ state: "open" });
    expect(findLead("Done. N", true)).toEqual({ state: "lead", start: 0, end: 5 });
    expect(findLead("Done.\n", true)).toEqual({ state: "lead", start: 0, end: 5 });
    // A finished reply's end is a sentence end.
    expect(findLead("Done.")).toEqual({ state: "lead", start: 0, end: 5 });
  });

  it("is decided by character position: streamed text never moves or drops the cut", () => {
    const replies = [
      "Here's how to run a retro. Open the board first.",
      "Pick a format, e.g. a table. Then fill it in.",
      "Velocity is 3.5 points a day. That's steady.",
      "Ask Mr. Smith first. He owns it.",
      'He wrote "flaky CI." Then he left.',
      "**All set.** The retro is open.\n\n- One\n- Two",
      "Here are the steps.\n\n1. Open the board\n2. Add a card",
      "Here's how to run it:\n\n1. Open the board",
      "- Open the board. Then add a card.",
      "1. Open the board.\n2. Add a card.",
      "| Tool | Use |\n|---|---|\n| Retro | Look back. |",
      "```ts\nconst a = 1;\n```\nThat sets it.",
      "مرحبا. كيف أساعدك؟",
      "Hmm... let me check. Done.",
      `${words(LEAD_MAX + 10)}. Short one.`,
      `${words(400)}. Then a short one.`,
      "Done!",
    ];
    for (const reply of replies) {
      let decided: ReturnType<typeof findLead> | null = null;
      for (let n = 0; n <= reply.length; n++) {
        const now = findLead(reply.slice(0, n), true);
        if (decided) expect(now, `${JSON.stringify(reply)} at ${n}`).toEqual(decided);
        else if (now.state !== "open") decided = now;
      }
      const final = findLead(reply);
      expect(final.state).not.toBe("open");
      if (decided) expect(final, JSON.stringify(reply)).toEqual(decided);
    }
  });
});

describe("chatView: messages as comic strip items", () => {
  it("turns the reader's words into a you item and Amr's into a balloon", () => {
    const items = chatView([
      user("u1", "How do I run a retro?"),
      assistant("a1", text("Here's how. Open the board first.")),
    ]);
    expect(items).toEqual([
      { kind: "you", key: "u1", messageId: "u1", text: "How do I run a retro?" },
      {
        kind: "balloon",
        key: "a1:t0",
        messageId: "a1",
        text: "Here's how. Open the board first.",
        lead: "Here's how.",
        held: false,
        wide: false,
        streaming: false,
      },
    ]);
  });

  it("keeps the reader's words verbatim and skips an empty message", () => {
    const items = chatView([user("u1", "**not bold**\n- not a list"), user("u2", "   ")]);
    expect(items).toEqual([
      { kind: "you", key: "u1", messageId: "u1", text: "**not bold**\n- not a list" },
    ]);
  });

  it("draws no balloon for a tool-only message: its calls are one step caption", () => {
    const items = chatView([
      user("u1", "Add flaky CI"),
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1")),
    ]);
    expect(kinds(items)).toEqual(["you", "steps"]);
    expect(balloons(items)).toEqual([]);
    const steps = items[1] as StepsItem;
    expect(steps.key).toBe("a1:s0");
    expect(steps.steps).toHaveLength(1);
    expect(steps.steps[0]).toMatchObject({
      key: "a1:s0",
      messageId: "a1",
      call: call("c1"),
      result: result("c1"),
      state: "done",
    });
  });

  it("draws no balloon for blank text beside the calls", () => {
    const items = chatView([assistant("a1", text("  \n"), call("c1"), text(""), call("c2"))]);
    expect(kinds(items)).toEqual(["steps"]);
    expect((items[0] as StepsItem).steps.map((s) => s.key)).toEqual(["a1:s1", "a1:s3"]);
  });

  it("draws a message's words and calls apart, in their order", () => {
    const items = chatView([
      assistant("a1", text("Let me check the board."), call("c1"), text("Found it. Adding now.")),
    ]);
    expect(kinds(items)).toEqual(["balloon", "steps", "balloon"]);
    expect(items.map((i) => i.key)).toEqual(["a1:t0", "a1:s1", "a1:t2"]);
  });

  it("joins a run of text blocks into one balloon", () => {
    const items = chatView([assistant("a1", text("First part."), text("Second part."))]);
    expect(balloons(items)).toHaveLength(1);
    expect(balloons(items)[0].text).toBe("First part.\n\nSecond part.");
  });

  it("draws the client's round-limit stand-in as a note, never a balloon", () => {
    const standIn =
      "Amr used all 6 tool rounds for this request before he could sum up. This turn ran 12 tool calls; 2 failed (`retro.add_card`).";
    const note: ContentBlock = { type: "text", text: standIn, note: true };
    const items = chatView([
      user("u1", "Tidy the retro"),
      assistant("a1", text("On it."), call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", note),
    ]);
    expect(kinds(items)).toEqual(["you", "balloon", "steps", "note"]);
    expect(items[3]).toEqual({ kind: "note", key: "a2:n0", messageId: "a2", text: standIn });
    expect(balloons(items).map((b) => b.text)).toEqual(["On it."]);
    // Beside the model's own words it ends their balloon, and a blank one draws nothing.
    const mixed = chatView([
      assistant("a1", text("First."), note, text("After."), { ...note, text: " " }),
    ]);
    expect(kinds(mixed)).toEqual(["balloon", "note", "balloon"]);
    expect(mixed.map((i) => i.key)).toEqual(["a1:t0", "a1:n1", "a1:t2"]);
  });

  it("gives a turn's rounds of calls one step caption when no words come between them", () => {
    const items = chatView([
      user("u1", "Tidy the retro"),
      assistant("a1", call("c1"), call("c2")),
      toolMsg("t1", result("c1"), result("c2")),
      assistant("a2", call("c3")),
      toolMsg("t2", result("c3")),
      assistant("a3", text("All tidy. Three cards moved.")),
    ]);
    expect(kinds(items)).toEqual(["you", "steps", "balloon"]);
    const steps = items[1] as StepsItem;
    expect(steps.key).toBe("a1:s0");
    expect(steps.steps.map((s) => s.key)).toEqual(["a1:s0", "a1:s1", "a2:s0"]);
    expect(steps.steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
  });

  it("starts a new step caption after words or a new question", () => {
    const items = chatView([
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", text("One more."), call("c2")),
      toolMsg("t2", result("c2")),
      user("u1", "And again"),
      assistant("a3", call("c3")),
    ]);
    expect(kinds(items)).toEqual(["steps", "balloon", "steps", "you", "steps"]);
  });

  it("pairs a result with its own round, and shows a result with no call as a step of its own", () => {
    const items = chatView([
      assistant("a1", call("tc_0")),
      toolMsg("t1", result("tc_0", '{"added":false}')),
      assistant("a2", call("tc_0")),
      toolMsg("t2", result("tc_0"), result("gone")),
    ]);
    const steps = (items[0] as StepsItem).steps;
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ["a1:s0", "failed"],
      ["a2:s0", "done"],
      ["t2:r1", "done"],
    ]);
    expect(steps[2]).toMatchObject({ messageId: "t2", call: null, result: result("gone") });
  });

  it("says where a call stands while the turn runs", () => {
    const messages = [
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", call("c2"), call("c3", { _partial: true }), call("c4")),
    ];
    const states = (opts: Parameters<typeof chatView>[1]) =>
      (chatView(messages, opts)[0] as StepsItem).steps.map((s) => s.state);
    expect(states({ busy: true, pendingId: "c4" })).toEqual([
      "done",
      "working",
      "preparing",
      "waiting",
    ]);
    // After the turn: a call that never got a result is unknown, and one whose
    // arguments never arrived never ran.
    expect(states({})).toEqual(["done", null, "failed", null]);
  });

  it("marks a reply with a table or code as wide", () => {
    const [table, code, plain] = balloons(
      chatView([
        assistant("a1", text("Here they are.\n\n| Tool | Use |\n|---|---|\n| Retro | Look back |")),
        assistant("a2", text("Run this:\n\n```sh\nnpm test\n```")),
        assistant("a3", text("Just words. And a list:\n\n- one\n- two")),
      ])
    );
    expect(table.wide).toBe(true);
    expect(code.wide).toBe(true);
    expect(plain.wide).toBe(false);
  });

  it("holds the reply back while its first sentence is still open, then keeps the cut", () => {
    const view = (t: string) =>
      balloons(chatView([assistant("a1", text(t))], { streamingId: "a1", busy: true }))[0];
    // Undecided: nothing of it is drawn yet, so it never shows in Inter first.
    expect(view("Done")).toMatchObject({ held: true, lead: null, streaming: true });
    expect(view("Done.")).toMatchObject({ held: true, lead: null, streaming: true });
    expect(view("Done. The card")).toMatchObject({ held: false, lead: "Done.", streaming: true });
    expect(view("Done. The card is in.")).toMatchObject({ held: false, lead: "Done." });
    const final = balloons(chatView([assistant("a1", text("Done."))]))[0];
    expect(final).toMatchObject({ held: false, lead: "Done.", streaming: false });
  });

  it("holds an opener that ends up with no lead only until that is decided, then shows it in Inter", () => {
    const view = (t: string, streaming = true) =>
      balloons(chatView([assistant("a1", text(t))], streaming ? { streamingId: "a1" } : {}))[0];
    // Past LEAD_MAX with no sentence end: decided, never lettered.
    expect(view(words(LEAD_MAX - 1))).toMatchObject({ held: true, lead: null });
    expect(view(words(LEAD_MAX + 1))).toMatchObject({ held: false, lead: null });
    // A first line that breaks with no sentence end.
    expect(view("Here they are:")).toMatchObject({ held: true, lead: null });
    expect(view("Here they are:\n")).toMatchObject({ held: false, lead: null });
    // A list or Arabic: decided from the first character.
    expect(view("- Open the board")).toMatchObject({ held: false, lead: null });
    expect(view("مرحبا")).toMatchObject({ held: false, lead: null });
    // A turn that ends undecided settles: drawn, lettered or not.
    expect(view("Here they are", false)).toMatchObject({ held: false, lead: null });
  });

  it("settles the words before a call while the call streams", () => {
    const items = chatView(
      [assistant("a1", text("Let me check the board."), call("c1", { _partial: true }))],
      { streamingId: "a1", busy: true }
    );
    expect(balloons(items)[0]).toMatchObject({
      lead: "Let me check the board.",
      streaming: false,
    });
    expect((items[1] as StepsItem).steps[0].state).toBe("preparing");
  });

  it("gives Arabic, list-first and long-opening replies no lead", () => {
    const items = balloons(
      chatView([
        assistant("a1", text("مرحبا. كيف أساعدك؟")),
        assistant("a2", text("1. Open the board.\n2. Add a card.")),
        assistant("a3", text(`${words(400)}. Then a short one.`)),
      ])
    );
    expect(items.map((b) => b.lead)).toEqual([null, null, null]);
  });
});

describe("createChatView: keeps what didn't change", () => {
  it("hands back the same array when nothing changed", () => {
    const view = createChatView();
    const messages = [user("u1", "Hi"), assistant("a1", text("Hello. How can Amr help?"))];
    const first = view(messages);
    expect(view(messages)).toBe(first);
    // New message objects with the same words still read as unchanged.
    expect(view(messages.map((m) => ({ ...m, content: [...m.content] })))).toBe(first);
  });

  it("makes a new item only for the reply that grew", () => {
    const view = createChatView();
    const before = [
      user("u1", "Tidy the retro"),
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", text("All")),
    ];
    const first = view(before, { streamingId: "a2", busy: true });
    const grown = [...before.slice(0, 3), assistant("a2", text("All tidy."))];
    const second = view(grown, { streamingId: "a2", busy: true });
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).not.toBe(first[2]);
    // Its one sentence could still run on: held, not drawn in a face it might lose.
    expect(second[2]).toMatchObject({ text: "All tidy.", streaming: true, held: true, lead: null });
    // The stream ends: the same words settle, shown lettered from their first draw.
    const third = view(grown, {});
    expect(third[2]).toMatchObject({ streaming: false, held: false, lead: "All tidy." });
    expect(third[0]).toBe(first[0]);
  });

  it("makes a new step caption when a result comes, keeping its key and its other steps", () => {
    const view = createChatView();
    const calls = assistant("a1", call("c1"), call("c2"));
    // The store keeps a block's identity across patches.
    const r1 = result("c1");
    const first = view([calls, toolMsg("t1", r1)], { busy: true });
    const second = view([calls, toolMsg("t1", r1, result("c2"))], { busy: true });
    const a = first[0] as StepsItem;
    const b = second[0] as StepsItem;
    expect(b).not.toBe(a);
    expect(b.key).toBe(a.key);
    expect(b.steps[0]).toBe(a.steps[0]);
    expect(b.steps[1]).not.toBe(a.steps[1]);
    expect(b.steps[1].state).toBe("done");
  });

  it("keeps a note while its words don't change", () => {
    const view = createChatView();
    const note: ContentBlock = { type: "text", text: "Amr used all 6 tool rounds.", note: true };
    const first = view([assistant("a1", note)]);
    const second = view([assistant("a1", { ...note })]);
    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
  });

  it("keeps a step caption's key as later rounds join it", () => {
    const view = createChatView();
    const round1 = [assistant("a1", call("c1")), toolMsg("t1", result("c1"))];
    const first = view(round1, { busy: true });
    const second = view([...round1, assistant("a2", call("c2"))], { busy: true });
    expect(second).toHaveLength(1);
    expect(second[0].key).toBe(first[0].key);
    expect((second[0] as StepsItem).steps[0]).toBe((first[0] as StepsItem).steps[0]);
  });
});
