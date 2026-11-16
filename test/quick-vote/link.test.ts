/**
 * The link that opens Quick Vote with a poll set up (lib/quick-vote/link):
 * what Picker's "Vote in Quick Vote" sends, and how Quick Vote reads any
 * link, checking and capping every value and ignoring the rest.
 */

import { describe, expect, it } from "vitest";
import {
  LINK_OPTION_CHARS,
  LINK_OPTIONS_MAX,
  LINK_QUESTION_CHARS,
  pollLinkHref,
  readPollLink,
} from "@/lib/quick-vote/link";
import { QUESTION_MAX } from "@/lib/quick-vote/draft";

const search = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

describe("the poll link", () => {
  it("reads back what it carries", () => {
    const href = pollLinkHref("Which name should we pick?", ["Volga", "Nile", "Amazon"]);
    expect(href.startsWith("/quick-vote?")).toBe(true);
    expect(readPollLink(href.slice(href.indexOf("?")))).toEqual({
      question: "Which name should we pick?",
      options: ["Volga", "Nile", "Amazon"],
    });
  });

  it("asks for a poll only", () => {
    expect(readPollLink("")).toBeNull();
    expect(readPollLink("?slice=abc")).toBeNull();
    expect(readPollLink(search({ preset: "dots", options: "A\nB" }))).toBeNull();
    expect(readPollLink(search({ preset: "POLL", options: "A\nB" }))).toBeNull();
    // A poll with nothing else: the poll's own question, no options.
    expect(readPollLink("?preset=poll")).toEqual({ question: null, options: [] });
  });

  it("caps the options: 20 at most, 30 characters each, each once", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Name ${i + 1}`);
    const read = readPollLink(search({ preset: "poll", options: many.join("\n") }))!;
    expect(read.options).toEqual(many.slice(0, LINK_OPTIONS_MAX));

    const long = "A".repeat(80);
    const mixed = ["  Volga  ", "", "volga", long, "Nile\r", "‮Nile2"].join("\n");
    expect(readPollLink(search({ preset: "poll", options: mixed }))!.options).toEqual([
      "Volga",
      "A".repeat(LINK_OPTION_CHARS),
      "Nile",
      "Nile2",
    ]);
  });

  it("cleans the question, cuts it to what a round takes, and ignores one too long", () => {
    expect(readPollLink(search({ preset: "poll", question: "  Which\tname?\n" }))!.question).toBe(
      "Which name?"
    );
    const longish = "Q".repeat(LINK_QUESTION_CHARS);
    expect(readPollLink(search({ preset: "poll", question: longish }))!.question).toBe(
      "Q".repeat(QUESTION_MAX)
    );
    const tooLong = "Q".repeat(LINK_QUESTION_CHARS + 1);
    expect(readPollLink(search({ preset: "poll", question: tooLong }))!.question).toBeNull();
    expect(readPollLink(search({ preset: "poll", question: "   " }))!.question).toBeNull();
  });

  it("ignores anything else in the link", () => {
    const read = readPollLink(
      search({
        preset: "poll",
        options: "A\nB",
        mode: "multi",
        limit: "5",
        customId: "qvf-x",
        backlogItemId: "b1",
      })
    );
    expect(read).toEqual({ question: null, options: ["A", "B"] });
  });
});
