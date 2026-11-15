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
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, type ReactNode } from "react";
import {
  ChatProvider,
  NO_CHAT,
  useChat,
  type ChatContextValue,
} from "@/components/agent/chat/chat-context";
import { ChatItemView } from "@/components/agent/chat/chat-items";
import {
  LEAD_MAX,
  chatView,
  createChatView,
  type ChatItem,
  type ChatViewOptions,
} from "@/lib/agent/chat-view";
import type { ChatProfile } from "@/lib/agent/store";
import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

/** How often each reply's markdown rendered, by its source. */
const renders = vi.hoisted(() => new Map<string, number>());

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

/** The strip's items in a chat, as a log draws them. */
function Strip({
  items,
  profile = "visitor",
}: {
  items: readonly ChatItem[];
  profile?: ChatProfile;
}) {
  return (
    <ChatProvider profile={profile}>
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

  it("waits while the first sentence streams, then letters it for good", () => {
    const view = createChatView();
    const growing = (t: string) => view([assistant("a1", text(t))], { streamingId: "a1" });
    const { rerender, getByTestId } = render(<Strip items={growing("Done")} />);
    expect(getByTestId("log").querySelector("[data-balloon-lead]")).toBeNull();
    rerender(<Strip items={growing("Done. The")} />);
    const lead = getByTestId("log").querySelector("[data-balloon-lead]");
    expect(lead).toHaveTextContent(/^Done\.$/);
    rerender(<Strip items={growing("Done. The card is on the board.")} />);
    expect(getByTestId("log").querySelector("[data-balloon-lead]")).toBe(lead);
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
    strip([assistant("a1", call("c1")), toolMsg("t1", result("c1"))], { profile: "owner" });
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
    // Trouble is said in words, with the danger colour as a second cue.
    expect(screen.getByText("Didn't work")).toHaveClass("text-danger");
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

describe("memoised items", () => {
  it("re-renders only the reply still growing as chunks stream in", () => {
    const view = createChatView();
    const first = "Open the board first.";
    const history = [user("u1", "How?"), assistant("a1", text(first)), user("u2", "And then?")];
    const items = (reply: string) =>
      view([...history, assistant("a2", text(reply))], { streamingId: "a2", busy: true });
    const { rerender } = render(<Strip items={items("Add")} />);
    for (const reply of ["Add a", "Add a card", "Add a card. Then vote."]) {
      rerender(<Strip items={items(reply)} />);
    }
    expect(renders.get(first)).toBe(1);
    expect(renders.get("Add a card. Then vote.")).toBe(1);
    expect(renders.get("Add a")).toBe(1);
  });

  it("keeps a finished step caption's element while the next reply streams", () => {
    const view = createChatView();
    const base = [assistant("a1", call("c1")), toolMsg("t1", result("c1"))];
    const items = (reply: string) =>
      view([...base, assistant("a2", text(reply))], { streamingId: "a2", busy: true });
    const { rerender, getByTestId } = render(<Strip items={items("Done")} />);
    const caption = getByTestId("log").querySelector('[data-chat-item="steps"]');
    const before = items("Done");
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
