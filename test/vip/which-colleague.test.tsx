/**
 * Which Colleague Are You?: built and tested, and hidden until the owner approves
 * the questions. The questions must come from the bible's cast and keep its
 * dignity rule, and nothing about a game leaves the page.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

const KEY = "testkey12345";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "agile-toolkit:vip" && h.cookie !== undefined
        ? { name, value: h.cookie }
        : undefined,
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import WhichColleaguePage from "@/app/(tools)/which-colleague/page";
import { WhichColleagueClient } from "@/app/(tools)/which-colleague/which-colleague-client";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import { getToolById } from "@/lib/constants/tools";
import { getVipTools, getVisibleTools } from "@/lib/tools/catalog";
import { CAST } from "@/lib/vip/cast.generated";
import { closestColleague, type ColleagueQuestion } from "@/lib/vip/which-colleague";
import {
  WHICH_COLLEAGUE_APPROVED,
  WHICH_COLLEAGUE_GAME,
} from "@/lib/vip/which-colleague-questions";

const { questions } = WHICH_COLLEAGUE_GAME;

beforeEach(() => {
  h.cookie = undefined;
});
afterEach(cleanup);

describe("until the owner approves", () => {
  it("is not approved, and says so in the file", () => {
    expect(WHICH_COLLEAGUE_APPROVED).toBe(false);
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/vip/which-colleague-questions.ts"),
      "utf8"
    );
    expect(src).toContain("OWNER APPROVAL NEEDED");
    expect(src).toContain("export const WHICH_COLLEAGUE_APPROVED = false;");
  });

  it("the catalog's mirror of the flag agrees with it", () => {
    expect(Boolean(getToolById("which-colleague")?.pendingApproval)).toBe(
      !WHICH_COLLEAGUE_APPROVED
    );
  });

  it("stays out of the hub and every listing, hint or no hint", () => {
    expect(getVipTools().map((t) => t.id)).not.toContain("which-colleague");
    for (const vip of [false, true]) {
      for (const showAll of [false, true]) {
        expect(getVisibleTools(showAll, vip).map((t) => t.id)).not.toContain("which-colleague");
      }
    }
    expect(getVisibleTools(false, true).map((t) => t.id)).toContain("squad-session");
  });

  it("a book reader's direct link says coming soon, with none of the game", async () => {
    h.cookie = KEY;
    const el = await WhichColleaguePage();
    expect(el.type).not.toBe(VipLockPanel);
    expect(JSON.stringify(el.props)).not.toContain(questions[0].prompt);
    const { container } = render(el);
    expect(screen.getByText("This one is coming soon")).toBeInTheDocument();
    for (const q of questions) expect(container.innerHTML).not.toContain(q.prompt);
    expect(container.innerHTML).not.toContain(WHICH_COLLEAGUE_GAME.discussion);
  });

  it("a locked visitor gets the lock panel instead", async () => {
    expect((await WhichColleaguePage()).type).toBe(VipLockPanel);
  });
});

describe("the questions", () => {
  const names = new Set(CAST.map((c) => c.name));

  it("are 8 to 10, each with choices that point at real colleagues", () => {
    expect(questions.length).toBeGreaterThanOrEqual(8);
    expect(questions.length).toBeLessThanOrEqual(10);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const q of questions) {
      expect(q.answers.length, q.id).toBeGreaterThanOrEqual(2);
      expect(new Set(q.answers.map((a) => a.id)).size, q.id).toBe(q.answers.length);
      for (const a of q.answers) {
        expect(a.colleagues.length, a.text).toBeGreaterThan(0);
        for (const name of a.colleagues) expect(names.has(name), name).toBe(true);
      }
    }
  });

  it("can lead to every colleague in the cast", () => {
    const reached = new Set(questions.flatMap((q) => q.answers.flatMap((a) => a.colleagues)));
    expect(Array.from(names).filter((n) => !reached.has(n))).toEqual([]);
  });

  it("never reads as a label on a person", () => {
    const text = [
      ...questions.flatMap((q) => [q.prompt, ...q.answers.map((a) => a.text)]),
      WHICH_COLLEAGUE_GAME.intro,
      WHICH_COLLEAGUE_GAME.resultLead,
      WHICH_COLLEAGUE_GAME.dignityNote,
      WHICH_COLLEAGUE_GAME.discussion,
    ].join("\n");
    expect(text).not.toMatch(
      /\byou are\b|\byou're a\b|\bwhich .* are you\b|\bthe kind of person\b/i
    );
    expect(text).not.toMatch(/\b(lazy|bad|worst|annoying|stupid|fault)\b/i);
    expect(WHICH_COLLEAGUE_GAME.dignityNote).toMatch(/habit, not about you/);
  });
});

describe("closestColleague", () => {
  const qs: ColleagueQuestion[] = [
    {
      id: "1",
      prompt: "",
      answers: [
        { id: "a", text: "", colleagues: ["Fox"] },
        { id: "b", text: "", colleagues: ["Owl"] },
      ],
    },
    {
      id: "2",
      prompt: "",
      answers: [
        { id: "a", text: "", colleagues: ["Owl"] },
        { id: "b", text: "", colleagues: ["Hen"] },
      ],
    },
    {
      id: "3",
      prompt: "",
      answers: [
        { id: "a", text: "", colleagues: ["Owl"] },
        { id: "b", text: "", colleagues: ["Fox"] },
      ],
    },
  ];

  it("picks the colleague picked most", () => {
    expect(closestColleague(qs, { "1": "a", "2": "a", "3": "a" })).toBe("Owl");
  });

  it("breaks a tie by who came first", () => {
    expect(closestColleague(qs, { "1": "a", "2": "b", "3": "a" })).toBe("Fox");
  });

  it("gives nothing with no answers", () => {
    expect(closestColleague(qs, {})).toBeNull();
  });
});

describe("the game, as it will play once approved", () => {
  const play = () => {
    for (let i = 0; i < questions.length; i++) {
      fireEvent.click(screen.getByRole("button", { name: questions[i].answers[0].text }));
    }
  };

  beforeEach(() => {
    render(
      <LiveAnnouncerProvider>
        <WhichColleagueClient game={WHICH_COLLEAGUE_GAME} cast={CAST} />
      </LiveAnnouncerProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
  });

  it("walks the questions, then shows a card and a question to discuss", () => {
    expect(screen.getByText(`Question 1 of ${questions.length}`)).toBeInTheDocument();
    play();
    const name = closestColleague(
      questions,
      Object.fromEntries(questions.map((q) => [q.id, q.answers[0].id]))
    )!;
    const card = CAST.find((c) => c.name === name)!;
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByText(card.overused_strength)).toBeInTheDocument();
    expect(screen.getByText(WHICH_COLLEAGUE_GAME.discussion)).toBeInTheDocument();
    expect(screen.getByText(WHICH_COLLEAGUE_GAME.dignityNote)).toBeInTheDocument();
  });

  it("sends nothing and stores nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const before = JSON.stringify({ ...localStorage });
    play();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    fetchSpy.mockRestore();
    const src = readFileSync(
      path.join(process.cwd(), "src/app/(tools)/which-colleague/which-colleague-client.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage|persist/);
  });

  it("passes on to the next person and keeps the round", () => {
    play();
    fireEvent.click(screen.getByRole("button", { name: /Next person/ }));
    expect(screen.getByText(`Question 1 of ${questions.length}`)).toBeInTheDocument();
    play();
    expect(screen.getByText(/So far this round:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
