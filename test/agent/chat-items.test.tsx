/**
 * The comic strip as the log draws it (src/components/agent/chat/chat-items.tsx):
 * Amr's replies in balloons whose tail points at the real Amr, on his side;
 * the reader's words in you captions across from him; a reply's lettered lead
 * inside its first paragraph; full-width balloons for tables and code; one
 * narration caption per run of tool calls, in words, with Details for the
 * owner only; no balloon for a message with only tool calls; and memoised
 * items, so a streamed chunk re-renders only the reply still growing. The view
 * items themselves are pinned in chat-view.test.ts.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, type ReactNode } from "react";
import { z } from "zod";
import { ChatComposer } from "@/components/agent/chat/chat-composer";
import {
  ChatProvider,
  NO_CHAT,
  useChat,
  type ChatContextValue,
} from "@/components/agent/chat/chat-context";
import { ChatItemView, PICKED_UP, latestReply } from "@/components/agent/chat/chat-items";
import {
  COPY_FAILED,
  FOLLOW_UPS_LABEL,
  REPLY_COPIED,
  ReplyEnd,
  retryCost,
  type ReplyRetry,
} from "@/components/agent/chat/reply-end";
import { StepDetails } from "@/components/agent/chat/step-details";
import { ChatStrip, useChatItems } from "@/components/agent/chat/chat-strip";
import { registry } from "@/lib/actions/registry";
import { canRetryLastTurn } from "@/lib/agent/client";
import { FOLLOW_UP_TEXT, followUps, moreIn } from "@/lib/agent/follow-ups";
import {
  LEAD_MAX,
  chatView,
  createChatView,
  type ChatItem,
  type ChatViewOptions,
} from "@/lib/agent/chat-view";
import { useAgentStore, type ChatProfile } from "@/lib/agent/store";
import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

/** How often each reply's markdown rendered, by its source. */
const renders = vi.hoisted(() => new Map<string, number>());

const h = vi.hoisted(() => ({
  /** The clipboard helper: whether the clipboard took the text. */
  copy: vi.fn<(text: string) => Promise<boolean>>(async () => true),
  announce: vi.fn(),
  onSend: vi.fn(),
}));

vi.mock("@/lib/utils/clipboard", () => ({ copyToClipboard: h.copy }));
vi.mock("@/components/a11y/live-announcer", () => ({ useAnnounce: () => h.announce }));

vi.mock("@/components/agent/markdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/agent/markdown")>();
  return {
    ...real,
    // The real renderer, counted: its hooks run as this component's own.
    Markdown: (props: Parameters<typeof real.Markdown>[0]) => {
      renders.set(props.source, (renders.get(props.source) ?? 0) + 1);
      return real.Markdown(props);
    },
  };
});

const ROOT = path.resolve(__dirname, "../..");
const CHAT_DIR = path.join(ROOT, "src/components/agent/chat");
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
const result = (callId: string, content = '{"added":true}', isError = false): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: callId,
  content,
  ...(isError && { is_error: true }),
});

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const all = (root: Element) => [root, ...Array.from(root.querySelectorAll("*"))];
/** A string of `n` characters of plain Latin words, with no sentence end. */
const words = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

/** The strip's items in a chat, as a log draws them, with Details handed in as the owner's chat does. */
function Strip({
  items,
  profile = "visitor",
}: {
  items: readonly ChatItem[];
  profile?: ChatProfile;
}) {
  return (
    <ChatProvider profile={profile} stepDetails={StepDetails}>
      <div data-testid="log">
        {items.map((item) => (
          <ChatItemView key={item.key} item={item} />
        ))}
      </div>
    </ChatProvider>
  );
}

function strip(
  messages: ChatMessage[],
  { profile, ...opts }: ChatViewOptions & { profile?: ChatProfile } = {}
) {
  const { container } = render(<Strip items={chatView(messages, opts)} profile={profile} />);
  // This render's own log: a test may draw several.
  return container.querySelector<HTMLElement>('[data-testid="log"]')!;
}

/** The one balloon drawn for a reply. */
function balloonFor(reply: string): HTMLElement {
  const log = strip([assistant("a1", text(reply))]);
  const found = log.querySelectorAll<HTMLElement>(".balloon");
  expect(found).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  renders.clear();
});

describe("Amr's balloons and the reader's captions", () => {
  it("draws Amr's reply in a balloon whose tail points at the real Amr, and says who spoke", () => {
    const log = strip([
      user("u1", "How do I run a retro?"),
      assistant("a1", text("Open the board.")),
    ]);
    const balloon = log.querySelector(".balloon")!;
    expect(balloon).toHaveAttribute("data-tail", "amr");
    expect(balloon).toHaveAttribute("data-speaker", "amr");
    expect(balloon.querySelector(".sr-only")).toHaveTextContent("Amr said:");
    expect(balloon).toHaveTextContent("Open the board.");
    const caption = log.querySelector('.comic-caption[data-voice="you"]')!;
    expect(caption.querySelector(".sr-only")).toHaveTextContent("You said:");
    expect(caption).toHaveTextContent("How do I run a retro?");
    // In order: the question, then the answer.
    expect(
      caption.compareDocumentPosition(balloon) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows the reader's words verbatim, never as markdown", () => {
    const log = strip([user("u1", "Add **flaky CI**\n- to the board")]);
    const caption = log.querySelector('[data-chat-item="you"] [data-comic-content]')!;
    expect(caption.textContent).toBe("Add **flaky CI**\n- to the board");
    expect(caption.querySelector("strong, ul, li")).toBeNull();
  });

  it("stands balloons on Amr's side, with room for the tail, and captions across from him", () => {
    const log = strip([user("u1", "Hi"), assistant("a1", text("Hello."))]);
    const balloon = log.querySelector(".balloon")!;
    // Amr on the left (no panel says otherwise): the tail's room on the left.
    expect(classes(balloon)).toEqual(expect.arrayContaining(["ml-3.5", "mr-auto"]));
    // Mirrored when he stands on the right, read off the panel root.
    expect(classes(balloon)).toEqual(
      expect.arrayContaining([
        "group-data-[amr-side=right]/amr:ml-auto",
        "group-data-[amr-side=right]/amr:mr-3.5",
      ])
    );
    const caption = log.querySelector('.comic-caption[data-voice="you"]')!;
    expect(classes(caption)).toContain("ml-auto");
    expect(classes(caption)).toEqual(
      expect.arrayContaining([
        "group-data-[amr-side=right]/amr:ml-0",
        "group-data-[amr-side=right]/amr:mr-auto",
      ])
    );
  });

  it("draws no second Amr, no live region and nothing that moves in", () => {
    const log = strip([
      user("u1", "Add a card"),
      assistant("a1", text("On it."), call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", text("Done. The card is on the board.")),
    ]);
    expect(log.querySelector("img, picture, canvas, svg[role='img']")).toBeNull();
    expect(
      log.querySelector("[aria-live], [role='status'], [role='alert'], [role='log']")
    ).toBeNull();
    for (const el of all(log)) {
      for (const c of classes(el)) {
        expect(c).not.toMatch(/(?:^|:)(?:animate-\S+|rounded-full|uppercase)$/);
        expect(c).not.toMatch(/(?:fade-in|zoom-in)/);
      }
    }
  });
});

describe("a reply's lettered lead", () => {
  /** The lettered lead's text, or null when the reply has none. */
  const leadIn = (reply: string) => {
    const balloon = balloonFor(reply);
    const lettered = all(balloon).filter((el) => el.classList.contains("font-display"));
    const lead = balloon.querySelector("[data-balloon-lead]");
    expect(lettered).toEqual(lead ? [lead] : []);
    return lead?.textContent ?? null;
  };

  it("letters a short first sentence, inside the first paragraph", () => {
    const balloon = balloonFor("Here's how to run a retro. Open the board first.");
    const lead = balloon.querySelector("[data-balloon-lead]")!;
    expect(lead.textContent).toBe("Here's how to run a retro.");
    expect(classes(lead)).toEqual(expect.arrayContaining(["font-display", "text-[0.9375rem]"]));
    const p = lead.closest("p")!;
    expect(p.textContent).toBe("Here's how to run a retro. Open the board first.");
    // Inside the content, after the speaker's hidden name.
    expect(balloon.querySelector("[data-comic-content]")!.contains(p)).toBe(true);
  });

  it("letters nothing when the first sentence runs long", () => {
    const fits = `${words(LEAD_MAX - 1)}.`;
    expect(leadIn(`${fits} Next.`)).toBe(fits);
    expect(leadIn(`${words(LEAD_MAX + 20)}. Next.`)).toBeNull();
  });

  it("letters nothing when the reply opens with a list", () => {
    expect(leadIn("1. Open the board.\n2. Add a card.")).toBeNull();
    expect(leadIn("- Open the board. Then add a card.")).toBeNull();
  });

  it("letters nothing when the reply opens with a table", () => {
    expect(leadIn("| Tool | Use |\n|---|---|\n| Retro | Look back. |")).toBeNull();
  });

  it("reads past e.g. to the real end of the sentence", () => {
    expect(leadIn("Pick a format, e.g. a table. Then fill it in.")).toBe(
      "Pick a format, e.g. a table."
    );
  });

  it("letters nothing when the opening never ends a sentence", () => {
    expect(leadIn("Sure thing here it is")).toBeNull();
  });

  it("letters nothing in an Arabic reply", () => {
    expect(leadIn("هذه خطة السبرينت. افتح اللوحة أولا.")).toBeNull();
    const p = balloonFor("هذه خطة السبرينت. افتح اللوحة أولا.").querySelector("p")!;
    expect(p).toHaveAttribute("dir", "auto");
  });

  it("letters nothing for a 400-character opening", () => {
    expect(leadIn(`${words(400)}. Then a short one.`)).toBeNull();
    expect(leadIn(words(400))).toBeNull();
  });

  /** The streamed reply's one balloon row in the log. */
  const rowIn = (log: HTMLElement) => {
    const rows = log.querySelectorAll<HTMLElement>('[data-chat-item="balloon"]');
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  /** While held: the balloon scribbles, and none of the opener's words show, in any face. */
  const expectHeld = (row: HTMLElement) => {
    expect(row).toHaveAttribute("data-held");
    expect(row.querySelector("[data-thinking]")).toHaveAttribute("aria-hidden", "true");
    expect(row.textContent).toBe("");
  };

  it("holds the words back while the first sentence streams, so they first show lettered, for good", () => {
    const view = createChatView();
    const growing = (t: string) => view([assistant("a1", text(t))], { streamingId: "a1" });
    const { rerender, getByTestId } = render(<Strip items={growing("D")} />);
    // Undecided: never drawn in Inter, to turn lettered a chunk later.
    for (const t of ["D", "Done", "Done.", "Done. "]) {
      rerender(<Strip items={growing(t)} />);
      expectHeld(rowIn(getByTestId("log")));
    }
    rerender(<Strip items={growing("Done. T")} />);
    const row = rowIn(getByTestId("log"));
    expect(row).not.toHaveAttribute("data-held");
    const lead = row.querySelector("[data-balloon-lead]");
    expect(lead).toHaveTextContent(/^Done\.$/);
    // Its first draw: no other face around it.
    expect(all(row).filter((el) => el.classList.contains("font-display"))).toEqual([lead]);
    for (const t of ["Done. The", "Done. The card is on the board."]) {
      rerender(<Strip items={growing(t)} />);
      expect(getByTestId("log").querySelector("[data-balloon-lead]")).toBe(lead);
    }
  });

  it("holds an opener with no lead only until that is decided, then shows it in Inter, never lettered", () => {
    const view = createChatView();
    const growing = (t: string) => view([assistant("a1", text(t))], { streamingId: "a1" });
    const long = words(LEAD_MAX + 30);
    const { rerender, getByTestId } = render(<Strip items={growing(long.slice(0, 60))} />);
    expectHeld(rowIn(getByTestId("log")));
    // Past LEAD_MAX with no sentence end: no lead, for good.
    for (const t of [long, `${long}. And more.`]) {
      rerender(<Strip items={growing(t)} />);
      const row = rowIn(getByTestId("log"));
      expect(row).not.toHaveAttribute("data-held");
      expect(row.querySelector("[data-balloon-lead], .font-display")).toBeNull();
      expect(row).toHaveTextContent(t.trim());
    }
    // A first line that breaks with no sentence end: shown at the break.
    const view2 = createChatView();
    const list = (t: string) => view2([assistant("a2", text(t))], { streamingId: "a2" });
    const second = render(<Strip items={list("Here they are:")} />);
    const log2 = second.container.querySelector<HTMLElement>('[data-testid="log"]')!;
    expectHeld(rowIn(log2));
    second.rerender(<Strip items={list("Here they are:\n- one")} />);
    expect(rowIn(log2)).not.toHaveAttribute("data-held");
    expect(log2.querySelector("[data-balloon-lead], .font-display")).toBeNull();
  });

  it("draws a reply whose stream ended undecided, at once", () => {
    const log = strip([assistant("a1", text("Done"))]);
    expect(rowIn(log)).not.toHaveAttribute("data-held");
    expect(rowIn(log)).toHaveTextContent("Done");
  });
});

describe("wide replies", () => {
  const row = (reply: string) => {
    const balloon = balloonFor(reply);
    return { balloon, row: balloon.closest('[data-chat-item="balloon"]')! };
  };

  it("runs a reply with a table or code across the log", () => {
    for (const reply of [
      "Two tools fit:\n\n| Tool | Use |\n|---|---|\n| Retro | Look back |",
      "Run this:\n\n```sh\nnpm test\n```",
    ]) {
      const { balloon, row: r } = row(reply);
      expect(r).toHaveAttribute("data-wide", "");
      expect(classes(balloon)).toContain("flex-1");
      expect(classes(balloon)).not.toContain("max-w-[85%]");
      // Still on Amr's side, with the tail's room.
      expect(classes(balloon)).toContain("ml-3.5");
    }
  });

  it("keeps a plain reply to its words' width", () => {
    const { balloon, row: r } = row("Open the board, then add a card.");
    expect(r).not.toHaveAttribute("data-wide");
    expect(classes(balloon)).toContain("max-w-[85%]");
    expect(classes(balloon)).not.toContain("flex-1");
  });
});

describe("tool steps", () => {
  it("draws no balloon for a message with only tool calls", () => {
    const log = strip([
      user("u1", "Add flaky CI"),
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1", '{"added":true,"id":"k1"}')),
    ]);
    expect(log.querySelector(".balloon")).toBeNull();
    const steps = log.querySelectorAll('[data-chat-item="steps"]');
    expect(steps).toHaveLength(1);
    expect(steps[0].querySelector(".comic-caption")).toHaveAttribute("data-voice", "narration");
    expect(steps[0]).toHaveTextContent("Retro Board · Add card · Done · “flaky CI”");
  });

  it("draws a reply's words and its calls apart, in their order", () => {
    const log = strip([
      assistant("a1", text("On it."), call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", text("All set.")),
    ]);
    expect(
      Array.from(log.querySelectorAll("[data-chat-item]")).map((el) =>
        el.getAttribute("data-chat-item")
      )
    ).toEqual(["balloon", "steps", "balloon"]);
    // The call isn't inside a balloon.
    expect(log.querySelector(".balloon [data-tool-step]")).toBeNull();
  });

  it("shows a visitor a step in words: no wire name, no JSON, no Details", () => {
    const log = strip([
      assistant("a1", call("c1", { text: "flaky CI", column: "wentWell" })),
      toolMsg("t1", result("c1", '{"added":true,"id":"k1"}')),
    ]);
    expect(log.textContent).not.toMatch(/[{}]|tool_retro|wentWell|"added"/);
    expect(screen.queryByText("Details")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(log.querySelector("[data-tool-step]")).toHaveAttribute("data-tool-step", "done");
  });

  it("gives the owner Details with the raw arguments and result, named for the step", () => {
    const log = strip([assistant("a1", call("c1")), toolMsg("t1", result("c1"))], {
      profile: "owner",
    });
    const summary = screen.getByText("Details").closest("summary")!;
    expect(summary).toHaveClass("pointer-coarse:min-h-11");
    act(() => summary.parentElement!.setAttribute("open", ""));
    const input = screen.getByRole("region", {
      name: "Input for Retro Board · Add card “flaky CI”",
    });
    const output = screen.getByRole("region", {
      name: "Result for Retro Board · Add card “flaky CI”",
    });
    expect(input.textContent).toContain('"text": "flaky CI"');
    expect(output.textContent).toBe('{"added":true}');
    for (const block of [input, output]) {
      expect(block).toHaveAttribute("tabindex", "0");
      expect(block).toHaveAttribute("dir", "ltr");
      expect(block).toHaveClass("font-data");
    }
    // The step's own line stays in words: no JSON, no wire name.
    const line = log.querySelector("[data-tool-step] p")!;
    expect(line.textContent).not.toMatch(/[{}]|"added"|tool_retro/);
    expect(log.textContent).not.toMatch(/tool_retro/);
  });

  it("cuts the owner's raw Details at 4,000 characters", () => {
    const long = "x".repeat(5000);
    strip([assistant("a1", call("c1")), toolMsg("t1", result("c1", long))], { profile: "owner" });
    const summary = screen.getByText("Details").closest("summary")!;
    act(() => summary.parentElement!.setAttribute("open", ""));
    const output = screen.getByRole("region", {
      name: "Result for Retro Board · Add card “flaky CI”",
    });
    expect(output.textContent).toBe(`${"x".repeat(4000)}…`);
  });

  it("puts a run of calls in one caption, a line each", () => {
    const log = strip([
      assistant("a1", call("c1"), call("c2", { text: "slow build" })),
      toolMsg("t1", result("c1"), result("c2", "Handler error: boom", true)),
    ]);
    const captions = log.querySelectorAll('[data-chat-item="steps"]');
    expect(captions).toHaveLength(1);
    const lines = captions[0].querySelectorAll("[data-tool-step]");
    expect(Array.from(lines).map((l) => l.getAttribute("data-tool-step"))).toEqual([
      "done",
      "failed",
    ]);
    expect(lines[1]).toHaveTextContent("Retro Board · Add card · Didn't work · “slow build”");
    // Trouble is said in words, with the caption's danger line and the
    // danger colour as second cues.
    expect(screen.getByText("Didn't work")).toHaveClass("text-danger");
    expect(captions[0].querySelector("[data-tool-steps]")).toHaveAttribute("data-tone", "error");
  });

  it("keeps a streaming call at Getting ready…, without its arguments", () => {
    const log = strip([assistant("a1", call("c1", { _partial: true }))], { busy: true });
    expect(log).toHaveTextContent("Retro Board · Add card · Getting ready…");
    expect(log.textContent).not.toContain("_partial");
  });

  it("still shows a result whose call isn't in the chat", () => {
    const log = strip([toolMsg("t1", result("c9", "Cancelled.", true))]);
    expect(log).toHaveTextContent("Step · Stopped");
  });
});

describe("scene captions", () => {
  it("names a new day in a <time> and marks where a picked-up thread left off, as scene captions", () => {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12);
    const log = strip(
      [
        { ...user("u1", "Plan the sprint"), createdAt: yesterday.toISOString() },
        { ...assistant("a1", text("Planned.")), createdAt: yesterday.toISOString() },
        { ...user("u2", "And now?"), createdAt: today.toISOString() },
      ],
      { resumedAfter: "a1" }
    );
    const scenes = Array.from(log.querySelectorAll('[data-chat-item="scene"]'));
    expect(scenes.map((s) => s.textContent)).toEqual(["Yesterday", PICKED_UP, "Today"]);
    for (const scene of scenes) {
      const caption = scene.querySelector(".comic-caption")!;
      expect(caption).toHaveAttribute("data-voice", "scene");
      // Narration, not anyone's words: no speaker.
      expect(caption.querySelector("[data-speaker]")).toBeNull();
    }
    expect(scenes[0].querySelector("time")).toHaveAttribute("dateTime", yesterday.toISOString());
    expect(scenes[1].querySelector("time")).toBeNull();
  });
});

describe("the client's notes", () => {
  it("draws the round-limit stand-in as narration, not Amr's words, with action ids as data", () => {
    const standIn =
      "Amr used all 6 tool rounds for this request before he could sum up. This turn ran 12 tool calls; 2 failed (`retro.add_card`).";
    const log = strip([
      user("u1", "Tidy the retro"),
      assistant("a1", call("c1")),
      toolMsg("t1", result("c1")),
      assistant("a2", { type: "text", text: standIn, note: true }),
    ]);
    expect(log.querySelector(".balloon")).toBeNull();
    const item = log.querySelector('[data-chat-item="note"]')!;
    expect(item).toHaveAttribute("data-message-id", "a2");
    const caption = item.querySelector('.comic-caption[data-voice="narration"]')!;
    expect(caption).toHaveAttribute("data-tone", "note");
    expect(caption.textContent).not.toMatch(/said:/);
    expect(caption.querySelector("[data-speaker]")).toBeNull();
    expect(caption).toHaveTextContent(
      "Amr used all 6 tool rounds for this request before he could sum up. This turn ran 12 tool calls; 2 failed (retro.add_card)."
    );
    // The markdown's chip, never literal backticks.
    expect(caption.textContent).not.toContain("`");
    const chip = caption.querySelector("code")!;
    expect(chip).toHaveTextContent("retro.add_card");
    expect(classes(chip)).toContain("font-data");
  });
});

describe("memoised items", () => {
  it("re-renders only the reply still growing as chunks stream in", () => {
    const view = createChatView();
    const first = "Open the board first.";
    const history = [user("u1", "How?"), assistant("a1", text(first)), user("u2", "And then?")];
    const items = (reply: string) =>
      view([...history, assistant("a2", text(reply))], { streamingId: "a2", busy: true });
    // Its opener decided from the first chunk, so every chunk is drawn.
    const { rerender } = render(<Strip items={items("Sure. Add")} />);
    for (const reply of ["Sure. Add a", "Sure. Add a card", "Sure. Add a card. Then vote."]) {
      rerender(<Strip items={items(reply)} />);
    }
    expect(renders.get(first)).toBe(1);
    expect(renders.get("Sure. Add a card. Then vote.")).toBe(1);
    expect(renders.get("Sure. Add a")).toBe(1);
  });

  it("keeps a finished step caption's element while the next reply streams", () => {
    const view = createChatView();
    const base = [assistant("a1", call("c1")), toolMsg("t1", result("c1"))];
    const items = (reply: string) =>
      view([...base, assistant("a2", text(reply))], { streamingId: "a2", busy: true });
    const { rerender, getByTestId } = render(<Strip items={items("Done. It")} />);
    const caption = getByTestId("log").querySelector('[data-chat-item="steps"]');
    const before = items("Done. It");
    rerender(<Strip items={items("Done. It is on the board.")} />);
    const after = items("Done. It is on the board.");
    expect(after[0]).toBe(before[0]);
    expect(getByTestId("log").querySelector('[data-chat-item="steps"]')).toBe(caption);
  });
});

describe("the chat context", () => {
  /** Keeps every value the context gave, render by render. */
  function Seen({ seen }: { seen: ChatContextValue[] }) {
    seen.push(useChat());
    return null;
  }

  it("gives a part with no chat around it a visitor's, with nothing to focus", () => {
    const seen: ChatContextValue[] = [];
    render(<Seen seen={seen} />);
    expect(seen[0]).toBe(NO_CHAT);
    expect(seen[0].profile).toBe("visitor");
    expect(seen[0].focusComposer()).toBe(false);
  });

  it("keeps its value across the container's renders, and changes it with the profile", () => {
    const seen: ChatContextValue[] = [];
    const ui = (profile: ChatProfile) => (
      <ChatProvider profile={profile}>
        <Seen seen={seen} />
      </ChatProvider>
    );
    const { rerender } = render(ui("owner"));
    rerender(ui("owner"));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0].profile).toBe("owner");
    expect(seen[0].logId).not.toBe(seen[0].composerId);
    rerender(ui("visitor"));
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[2].profile).toBe("visitor");
  });

  it("puts focus in the message box with the caret at the end, by ref or by id", () => {
    let chat: ChatContextValue = NO_CHAT;
    function Grab() {
      chat = useChat();
      return null;
    }
    function ByRef({ children }: { children: ReactNode }) {
      const ref = useRef<HTMLTextAreaElement>(null);
      return (
        <ChatProvider profile="owner" composerRef={ref}>
          <textarea ref={ref} aria-label="Message" defaultValue="Add a card" />
          {children}
        </ChatProvider>
      );
    }
    const first = render(
      <ByRef>
        <Grab />
      </ByRef>
    );
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    let focused = false;
    act(() => {
      focused = chat.focusComposer();
    });
    expect(focused).toBe(true);
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([10, 10]);
    first.unmount();

    function ById() {
      const c = useChat();
      chat = c;
      return <textarea id={c.composerId} aria-label="Message" defaultValue="Hi" />;
    }
    render(
      <ChatProvider profile="visitor">
        <ById />
      </ChatProvider>
    );
    act(() => {
      focused = chat.focusComposer();
    });
    expect(focused).toBe(true);
    const byId = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(byId);
    expect(byId.selectionStart).toBe(2);
  });
});

describe("fed from the store (chat-strip's useChatItems)", () => {
  /** The strip as both containers feed it: items made from the agent store. */
  function StoreStrip({ profile = "visitor" }: { profile?: ChatProfile }) {
    return <Strip items={useChatItems()} profile={profile} />;
  }
  const PROMPT = {
    verb: "Add card",
    title: "Retro Board",
    question: "Add a card to Retro Board?",
    detail: "Text: “flaky CI”",
    destructive: false,
  };

  afterEach(() => {
    useAgentStore.getState().reset();
  });

  it("says Working… once a call's arguments are in, and Waiting for you while its card shows", () => {
    act(() => {
      useAgentStore.setState({ streaming: true, messages: [assistant("a1", call("c1"))] });
    });
    render(<StoreStrip />);
    const log = screen.getByTestId("log");
    expect(log).toHaveTextContent("Retro Board · Add card · Working…");
    act(() => {
      useAgentStore.getState().setPendingToolUse({
        toolUseId: "c1",
        actionId: "tool_retro_add_card",
        resolvedActionId: "tool.retro.add_card",
        input: { text: "flaky CI" },
        prompt: PROMPT,
        resolve: () => {},
      });
    });
    expect(log).toHaveTextContent("Retro Board · Add card · Waiting for you · “flaky CI”");
    act(() => {
      useAgentStore.setState({
        streaming: false,
        pendingToolUse: null,
        messages: [assistant("a1", call("c1")), toolMsg("t1", result("c1"))],
      });
    });
    expect(log).toHaveTextContent("Retro Board · Add card · Done · “flaky CI”");
  });

  it("says each way a step can end, in words, never the result string", () => {
    const cases: Array<[string, boolean, string]> = [
      ["User denied execution of tool.retro.add_card.", true, "You said no"],
      ["Handler error: Retro not found", true, "Didn't work"],
      ["Tool not available: tool_retro_add_card", true, "Not available here"],
      ["Cancelled.", true, "Stopped"],
      ["Handler error: Handler timeout after 30000ms", true, "Took too long"],
      ['{"added":false,"reason":"no_retro"}', false, "Didn't work"],
    ];
    for (const [content, isError, said] of cases) {
      act(() => {
        useAgentStore.setState({
          messages: [assistant("a1", call("c1")), toolMsg("t1", result("c1", content, isError))],
        });
      });
      const { unmount } = render(<StoreStrip profile="owner" />);
      const caption = screen.getByTestId("log").querySelector('[data-chat-item="steps"] p')!;
      expect(caption).toHaveTextContent(`Retro Board · Add card · ${said}`);
      expect(caption.textContent).not.toContain(content);
      unmount();
    }
  });

  it("re-renders only the reply still growing as the store streams it", () => {
    const first = "Open the board first.";
    act(() => {
      useAgentStore.setState({
        streaming: true,
        streamingMessageId: "a2",
        messages: [
          user("u1", "How?"),
          assistant("a1", text(first)),
          user("u2", "And then?"),
          assistant("a2", text("Sure. Add")),
        ],
      });
    });
    render(<StoreStrip />);
    for (const reply of ["Sure. Add a", "Sure. Add a card", "Sure. Add a card. Then vote."]) {
      act(() => useAgentStore.getState().patchMessage("a2", [text(reply)]));
    }
    expect(renders.get(first)).toBe(1);
    expect(renders.get("Sure. Add a")).toBe(1);
    expect(renders.get("Sure. Add a card. Then vote.")).toBe(1);
    expect(screen.getByTestId("log")).toHaveTextContent("Sure. Add a card. Then vote.");
  });
});

describe("the end of the latest reply (ReplyEnd)", () => {
  const FIRST_PERSON = /\b(I|I'm|I'll|I've|me|my)\b/i;
  const READ = "tool_retro_list_cards";
  // The real rule for Try again (client canRetryLastTurn) reads each call's
  // category from the registry: one read and one change on Retro Board.
  for (const [name, category] of [
    ["list_cards", "read"],
    ["add_card", "write"],
  ] as const) {
    const id = `tool.retro.${name}`;
    if (!registry.resolve(id)) {
      registry.register({
        id,
        toolId: "tool.retro",
        name,
        category,
        description: `Probe: ${name}.`,
        paramsSchema: z.object({}),
        handler: async () => ({}),
      });
    }
  }

  /**
   * Both containers' chat: the store's strip with the shared composer as its
   * footer, and the reply's end handed in (`end`: false for a chat that has
   * none yet, as a visitor's before it loads).
   */
  function Chat({
    profile = "owner",
    busy = false,
    retry,
    end = true,
    composer = true,
  }: {
    profile?: ChatProfile;
    busy?: boolean;
    retry?: ReplyRetry;
    end?: boolean;
    composer?: boolean;
  }) {
    return (
      <ChatProvider profile={profile}>
        <ChatStrip
          busy={busy}
          replyEnd={end ? ReplyEnd : undefined}
          retry={retry}
          footer={
            composer ? <ChatComposer busy={busy} onSend={h.onSend} onStop={() => {}} /> : null
          }
        />
      </ChatProvider>
    );
  }

  type AgentState = ReturnType<typeof useAgentStore.getState>;
  const setChat = (messages: ChatMessage[], more: Partial<AgentState> = {}) =>
    act(() => useAgentStore.setState({ messages, ...more }));
  const ends = () => Array.from(document.querySelectorAll<HTMLElement>("[data-chat-reply-end]"));
  /** The one reply end in the chat. */
  const end = () => {
    const found = ends();
    expect(found).toHaveLength(1);
    return found[0];
  };
  const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  const readTurn = () => [
    user("u1", "What's on the board?"),
    assistant("a1", { type: "tool_use", id: "c1", name: READ, input: {} }),
    toolMsg("t1", result("c1", '{"cards":[]}')),
    assistant("a2", text("The board is empty.")),
  ];
  const writeTurn = () => [
    user("u1", "Add flaky CI"),
    assistant("a1", text("On it."), call("c1")),
    toolMsg("t1", result("c1")),
    assistant("a2", text("Added it to the board.")),
  ];
  /** Copy's promise and the note it leaves: past the clipboard helper's own tick. */
  const press = (button: HTMLElement) =>
    act(async () => {
      fireEvent.click(button);
      await new Promise((done) => setTimeout(done, 0));
    });

  beforeEach(() => {
    useAgentStore.getState().reset();
    h.copy.mockClear();
    h.copy.mockImplementation(async () => true);
    h.announce.mockClear();
    h.onSend.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().reset();
  });

  it("sits right under the latest reply only, once its turn has settled", () => {
    const history = [
      user("u1", "How do I run a retro?"),
      assistant("a1", text("Open the board.")),
      user("u2", "And then?"),
    ];
    const reply = assistant("a2", text("Add a card. Then vote."));
    // A turn under way: no reply has settled yet.
    setChat([...history, reply], { streaming: true, streamingMessageId: "a2" });
    const view = render(<Chat busy />);
    expect(ends()).toEqual([]);

    setChat([...history, reply], { streaming: false, streamingMessageId: null });
    view.rerender(<Chat />);
    const row = end();
    expect(row).toHaveAttribute("data-message-id", "a2");
    expect(row.previousElementSibling).toHaveAttribute("data-chat-item", "balloon");
    expect(row.previousElementSibling).toHaveAttribute("data-message-id", "a2");
    expect(screen.getByRole("log", { name: "Conversation" }).contains(row)).toBe(true);
    // On Amr's side, lined up with his balloon and mirrored when he moves.
    expect(classes(row.firstElementChild!)).toEqual(
      expect.arrayContaining(["ml-3.5", "group-data-[amr-side=right]/amr:justify-end"])
    );
    // Nothing under the earlier reply.
    expect(
      document.querySelector('[data-chat-item="balloon"][data-message-id="a1"]')!.nextElementSibling
    ).toHaveAttribute("data-chat-item", "you");

    // A new question: that reply is no longer the latest word.
    setChat([...history, reply, user("u3", "Thanks")]);
    expect(ends()).toEqual([]);
  });

  it("sits between a picked-up thread's last reply and the scene caption after it", () => {
    setChat([user("u1", "Plan the sprint"), assistant("a1", text("Start with the goal."))], {
      resumedAfter: "a1",
    });
    render(<Chat />);
    const row = end();
    expect(row.previousElementSibling).toHaveAttribute("data-message-id", "a1");
    expect(row.nextElementSibling).toHaveAttribute("data-chat-item", "scene");
  });

  it("draws nothing when the turn ended on its steps, on a note, or while a notice shows", () => {
    setChat([
      user("u1", "Add flaky CI"),
      assistant("a1", text("On it."), call("c1")),
      toolMsg("t1", result("c1")),
    ]);
    const view = render(<Chat />);
    expect(ends()).toEqual([]);
    setChat([
      user("u1", "Tidy the retro"),
      assistant("a1", text("Tidying.")),
      assistant("a2", { type: "text", text: "Amr used all 6 tool rounds.", note: true }),
    ]);
    expect(ends()).toEqual([]);

    setChat([user("u1", "Plan the sprint"), assistant("a1", text("Start with the goal."))]);
    end();
    // The notice is the turn's end then, with its own button.
    act(() =>
      useAgentStore
        .getState()
        .setNotice({ tone: "error", kind: "stream_failed", text: "The answer broke off." })
    );
    expect(ends()).toEqual([]);
    act(() => useAgentStore.getState().setNotice(null));
    end();
    view.unmount();
  });

  it("offers Try again after a turn that only read, never after one that ran a change", () => {
    const onTryAgain = vi.fn();
    const retry: ReplyRetry = { canRetry: canRetryLastTurn, onTryAgain };
    setChat(readTurn());
    const view = render(<Chat retry={retry} />);
    act(() => useAgentStore.getState().setDraft("owner", "and the"));
    onTryAgain.mockImplementation(() => {
      // Focus is in the box, caret at the end, before the turn starts and the button goes.
      expect(document.activeElement).toBe(box());
      expect(box().selectionStart).toBe("and the".length);
    });
    fireEvent.click(within(end()).getByRole("button", { name: "Try again" }));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(h.onSend).not.toHaveBeenCalled();
    view.unmount();

    setChat(writeTurn());
    const after = render(<Chat retry={retry} />);
    expect(within(end()).queryByRole("button", { name: /Try again/ })).toBeNull();
    // Copy still is.
    expect(within(end()).getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
    after.unmount();

    // No Try again the chat can run now (signed out): none, even after a read.
    setChat(readTurn());
    render(<Chat />);
    expect(within(end()).queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("hands focus to the latest question after a tap on a touch screen, never the box", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("pointer: coarse"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
        }) as unknown as MediaQueryList
    );
    const onTryAgain = vi.fn();
    setChat(readTurn());
    render(<Chat retry={{ canRetry: canRetryLastTurn, onTryAgain }} />);
    fireEvent.click(within(end()).getByRole("button", { name: "Try again" }), { detail: 1 });
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector('[data-chat-item="you"]'));
    expect(document.activeElement).not.toBe(box());
  });

  it("says on a visitor's Try again that it spends one of the messages left", () => {
    const retry = (left: number | null): ReplyRetry => ({
      canRetry: () => true,
      onTryAgain: () => {},
      left,
    });
    setChat([user("u1", "How do retros work?"), assistant("a1", text("Look back, then plan."))]);
    const view = render(<Chat profile="visitor" retry={retry(12)} />);
    const name = () => within(end()).getAllByRole("button")[1]?.textContent;
    expect(name()).toBe("Try again (uses 1 of your 12 left)");
    view.rerender(<Chat profile="visitor" retry={retry(1)} />);
    expect(name()).toBe("Try again (uses your last message)");
    view.rerender(<Chat profile="visitor" retry={retry(null)} />);
    expect(name()).toBe("Try again (uses 1 message)");
    // None left: the container hands in no Try again.
    view.rerender(<Chat profile="visitor" />);
    expect(within(end()).queryByRole("button", { name: /Try again/ })).toBeNull();

    for (const words of [
      "Copy reply",
      REPLY_COPIED,
      COPY_FAILED,
      ...[null, 1, 2, 12].map(retryCost),
    ]) {
      expect(words).not.toMatch(FIRST_PERSON);
      expect(words).not.toMatch(/[–—]/);
    }
  });

  it("copies the reply's markdown, and says so in the composer's status note, not a toast", async () => {
    const reply = "Two steps:\n\n1. **Open** the board.\n2. Add a card.";
    setChat([user("u1", "How?"), assistant("a1", text(reply))]);
    render(<Chat />);
    const copy = within(end()).getByRole("button", { name: "Copy reply" });
    await press(copy);
    expect(h.copy).toHaveBeenCalledTimes(1);
    expect(h.copy).toHaveBeenCalledWith(reply);
    const note = document.querySelector("[data-composer-note]")!;
    // The status row's one live span, polite: no toast, and no second announcement.
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveTextContent(REPLY_COPIED);
    expect(h.announce).not.toHaveBeenCalled();
    expect(document.querySelector("[data-sonner-toaster], [data-sonner-toast]")).toBeNull();
    // The button stays for another go.
    expect(copy).toBeInTheDocument();

    h.copy.mockImplementation(async () => false);
    await press(copy);
    expect(note).toHaveTextContent(COPY_FAILED);
  });

  it("says Copy's result through the app's announcer when no composer shows", async () => {
    setChat([user("u1", "How?"), assistant("a1", text("Open the board."))]);
    render(<Chat composer={false} />);
    await press(within(end()).getByRole("button", { name: "Copy reply" }));
    expect(h.copy).toHaveBeenCalledWith("Open the board.");
    expect(h.announce).toHaveBeenCalledWith(REPLY_COPIED);
  });

  it("offers up to two follow-ups that fill the message box and never send", () => {
    const asked = "Which retro formats are there?";
    const reply = "Three to pick from:\n\n- Start, stop, continue\n- Mad, sad, glad\n- 4Ls";
    setChat([user("u1", asked), assistant("a1", text(reply))]);
    const before = useAgentStore.getState().messages;
    render(<Chat />);
    const list = within(end()).getByRole("list", { name: FOLLOW_UPS_LABEL });
    const chips = within(list).getAllByRole("button");
    const expected = followUps({ reply, asked });
    expect(expected).toEqual([FOLLOW_UP_TEXT.ranks, FOLLOW_UP_TEXT.example]);
    expect(chips.map((chip) => chip.textContent)).toEqual(expected);
    // On Amr's side, and waiting while the panel is compact.
    expect(classes(list)).toEqual(
      expect.arrayContaining(["ml-3.5", "group-data-[amr-compact]/amr:hidden"])
    );

    fireEvent.click(chips[0]);
    expect(useAgentStore.getState().drafts.owner).toBe(expected[0]);
    expect(box()).toHaveValue(expected[0]);
    expect(document.activeElement).toBe(box());
    // Another swaps it; neither sends.
    fireEvent.click(chips[1]);
    expect(box()).toHaveValue(expected[1]);
    expect(h.onSend).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages).toBe(before);
    expect(useAgentStore.getState().streaming).toBe(false);
  });

  it("works the follow-ups out from the latest turn's own steps and question", () => {
    setChat([user("u0", "Hi"), assistant("a0", text("Hello.")), ...writeTurn()]);
    render(<Chat />);
    // The turn's change in Retro Board, not the earlier greeting.
    const chips = within(within(end()).getByRole("list", { name: FOLLOW_UPS_LABEL }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(chips[0]).toBe(moreIn("Retro Board"));
    // latestReply, which the log asks: that turn, its steps and its question.
    const found = latestReply(chatView(useAgentStore.getState().messages))!;
    expect(found.reply.messageId).toBe("a2");
    expect(found.reply.text).toBe("Added it to the board.");
    expect(found.asked).toBe("Add flaky CI");
    expect(found.steps.map((s) => [s.call?.id, s.state])).toEqual([["c1", "done"]]);
    expect(chips).toEqual(
      followUps({ reply: found.reply.text, steps: found.steps, asked: found.asked })
    );
  });

  it("draws no follow-ups for a reply in another script, only Copy reply", () => {
    setChat([user("u1", "كيف أبدأ؟"), assistant("a1", text("افتح اللوحة أولا."))]);
    render(<Chat profile="visitor" />);
    expect(within(end()).queryByRole("list")).toBeNull();
    expect(
      within(end())
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Copy reply"]);
  });

  it("draws no end at all until the chat hands one in (a visitor's, before it loads)", () => {
    setChat([user("u1", "How?"), assistant("a1", text("Open the board."))]);
    const view = render(<Chat end={false} />);
    expect(ends()).toEqual([]);
    view.rerender(<Chat />);
    end();
  });
});

describe("the chat folder's source", () => {
  const files = readdirSync(CHAT_DIR).filter((f) => /\.tsx?$/.test(f));

  it("reads every file under chat/", () => {
    expect(files).toEqual(expect.arrayContaining(["chat-items.tsx", "chat-context.tsx"]));
  });

  it("writes no entrance animation, pill shape or capitals into any file", () => {
    for (const f of files) {
      const src = readFileSync(path.join(CHAT_DIR, f), "utf8");
      expect(src, f).not.toMatch(/\b(?:animate-in|fade-in|zoom-in|animate-pulse)\b/);
      expect(src, f).not.toMatch(/\brounded-full\b/);
      expect(src, f).not.toMatch(/\buppercase\b/);
      // Tokens only: never a colour written into a class.
      expect(src, f).not.toMatch(/\[#[0-9a-f]{3,8}\]/i);
    }
  });
});
