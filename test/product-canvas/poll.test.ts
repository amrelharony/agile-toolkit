// @vitest-environment node
/**
 * The straw polls in Quick Vote (P2.3b): each idea or pitch a numbered
 * option, so two titles that share their first 30 characters stay two
 * options once Quick Vote reads the link; at most 20 go in, and `left`
 * counts the rest. Built on Quick Vote's own link, which carries the poll after the # sign.
 */

import { describe, expect, it } from "vitest";
import { canvasPoll } from "@/lib/product-canvas/poll";
import { LINK_OPTIONS_MAX, readPollLink } from "@/lib/quick-vote/link";

const read = (href: string) => readPollLink(href.slice(href.indexOf("#")));

describe("canvasPoll", () => {
  it("keeps two titles apart that share their first 30 characters", () => {
    const same = "Tips on the payment screen for food stalls";
    const poll = canvasPoll("Which idea should we look at first?", [
      { id: "a", title: same },
      { id: "b", title: `${same} and cafes` },
    ]);
    const link = read(poll.href);
    expect(link?.question).toBe("Which idea should we look at first?");
    expect(link?.options).toHaveLength(2);
    expect(link?.options[0].startsWith("1 Tips on the payment")).toBe(true);
    expect(link?.options[1].startsWith("2 Tips on the payment")).toBe(true);
    expect(poll.keys.get("a")).toBe("1");
    expect(poll.keys.get("b")).toBe("2");
    expect(poll.left).toBe(0);
  });

  it("puts at most 20 in, and counts the rest", () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, title: `Pitch ${i}` }));
    const poll = canvasPoll("Which pitch should we bet on?", items);
    expect(read(poll.href)?.options).toHaveLength(LINK_OPTIONS_MAX);
    expect(poll.left).toBe(3);
    expect(poll.keys.has("p19")).toBe(true);
    expect(poll.keys.has("p20")).toBe(false);
  });

  it("opens a plain poll, and nothing else", () => {
    const poll = canvasPoll("Which pitch should we bet on?", [{ id: "a", title: "Refunds" }]);
    expect(poll.href.startsWith("/quick-vote#preset=poll&")).toBe(true);
    // The titles ride after the # sign: the address a server sees holds none.
    const url = new URL(poll.href, "https://x.test");
    expect(url.pathname + url.search).toBe("/quick-vote");
    expect(url.hash).toContain("Refunds");
  });
});
