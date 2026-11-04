/**
 * Which Colleague Are You?: released to book readers. The questions must come
 * from the bible's cast and keep its dignity rule, and nothing about a game
 * leaves the page.
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
  NEVER_A_RESULT,
  WHICH_COLLEAGUE_APPROVED,
  WHICH_COLLEAGUE_GAME,
} from "@/lib/vip/which-colleague-questions";

const { questions } = WHICH_COLLEAGUE_GAME;

beforeEach(() => {
  h.cookie = undefined;
});
afterEach(cleanup);

describe("released", () => {
  it("is approved in the questions file", () => {
    expect(WHICH_COLLEAGUE_APPROVED).toBe(true);
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/vip/which-colleague-questions.ts"),
      "utf8"
    );
    expect(src).toContain("export const WHICH_COLLEAGUE_APPROVED = true;");
  });

  it("the catalog's mirror of the flag agrees with it", () => {
    expect(Boolean(getToolById("which-colleague")?.pendingApproval)).toBe(
      !WHICH_COLLEAGUE_APPROVED
    );
  });

  it("joins the hub, and the listings only for book readers", () => {
    expect(getVipTools().map((t) => t.id)).toContain("which-colleague");
    for (const showAll of [false, true]) {
      expect(getVisibleTools(showAll, true).map((t) => t.id)).toContain("which-colleague");
      expect(getVisibleTools(showAll, false).map((t) => t.id)).not.toContain("which-colleague");
    }
  });

  it("a book reader's direct link gets the game", async () => {
    h.cookie = KEY;
    const el = await WhichColleaguePage();
    expect(el.type).not.toBe(VipLockPanel);
    expect(el.props.game).toBe(WHICH_COLLEAGUE_GAME);
  });

  it("a locked visitor gets the lock panel, with none of the game", async () => {
    const el = await WhichColleaguePage();
    expect(el.type).toBe(VipLockPanel);
    expect(JSON.stringify(el.props ?? {})).not.toContain(questions[0].prompt);
  });
});

describe("the questions", () => {
  // Every colleague who can be a player's result.
  const names = new Set(CAST.map((c) => c.name).filter((n) => !NEVER_A_RESULT.includes(n)));

  it("never make a work item a player's result", () => {
    // The bible: Zombie Backlog "is never a diagnosis or an insult applied to a real colleague".
    expect(NEVER_A_RESULT).toEqual(["Zombie Backlog"]);
    const castNames = CAST.map((c) => c.name);
    for (const name of NEVER_A_RESULT) {
      expect(castNames, name).toContain(name);
      for (const q of questions) {
        for (const a of q.answers) expect(a.colleagues, `${q.id}${a.id}`).not.toContain(name);
      }
    }
  });

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

  it("offers every colleague in two different questions, so each can win outright", () => {
    for (const name of Array.from(names)) {
      const asked = questions.filter((q) => q.answers.some((a) => a.colleagues.includes(name)));
      expect(asked.length, name).toBeGreaterThanOrEqual(2);
    }
  });

  it("brings up the whole cast, and no question or colleague dominates", () => {
    // Every possible game, through the real function.
    const results = new Map<string, number>();
    const firstPicks = new Set(questions[0].answers.flatMap((a) => a.colleagues));
    const picks: Record<string, string> = {};
    let games = 0;
    const walk = (i: number) => {
      if (i === questions.length) {
        const name = closestColleague(questions, picks)!;
        results.set(name, (results.get(name) ?? 0) + 1);
        games++;
        return;
      }
      for (const answer of questions[i].answers) {
        picks[questions[i].id] = answer.id;
        walk(i + 1);
      }
    };
    walk(0);

    expect(games).toBe(4 ** questions.length);
    expect(Array.from(names).filter((n) => !results.has(n))).toEqual([]);

    const share = (name: string) => (results.get(name) ?? 0) / games;
    for (const name of Array.from(names)) {
      expect(share(name), name).toBeGreaterThan(0.02);
      expect(share(name), name).toBeLessThan(0.05);
    }
    // Colleagues offered in the first question win no more than their share of the cast.
    const firstShare = Array.from(firstPicks).reduce((sum, name) => sum + share(name), 0);
    expect(firstShare).toBeLessThan(0.25);
  }, 120_000);

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

  it("gives a tie to one of the leaders, the same one every time", () => {
    const split = { "1": "b", "2": "b" }; // Owl and Hen, one each.
    const first = closestColleague(qs, split);
    expect(["Owl", "Hen"]).toContain(first);
    expect(closestColleague(qs, split)).toBe(first);
  });

  it("doesn't favour the first question in a tie", () => {
    // Four questions, every answer a different colleague: all 256 games are ties.
    const distinct: ColleagueQuestion[] = ["1", "2", "3", "4"].map((id) => ({
      id,
      prompt: "",
      answers: ["a", "b", "c", "d"].map((a) => ({
        id: a,
        text: "",
        colleagues: [`${id}${a}`],
      })),
    }));
    const byQuestion = new Map<string, number>();
    const ids = ["a", "b", "c", "d"];
    for (const a of ids) {
      for (const b of ids) {
        for (const c of ids) {
          for (const d of ids) {
            const name = closestColleague(distinct, { "1": a, "2": b, "3": c, "4": d })!;
            byQuestion.set(name[0], (byQuestion.get(name[0]) ?? 0) + 1);
          }
        }
      }
    }
    for (const id of ["1", "2", "3", "4"]) {
      expect(byQuestion.get(id) ?? 0, id).toBeGreaterThan(30);
      expect(byQuestion.get(id) ?? 0, id).toBeLessThan(100);
    }
  });

  it("gives nothing with no answers", () => {
    expect(closestColleague(qs, {})).toBeNull();
  });
});

describe("the game", () => {
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
