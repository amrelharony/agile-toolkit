// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateCynefinPrompts } from "@/lib/ai-prompts/cynefin";
import { cynefinVerdict } from "@/lib/cynefin/model";
import type { CynefinItem, Hypothesis } from "@/lib/stores/workspace-types";

/**
 * The Cynefin prompt reads the board as the page does: the domain the team
 * confirmed, what the guided questions suggested when it differs (they only
 * suggest), each domain's recipe, a plan of the item's own, whether a
 * complex item is a hypothesis being tested, and the page's verdict.
 */

const AT = "2026-10-20T09:00:00.000Z";

const item = (over: Partial<CynefinItem> & Pick<CynefinItem, "id" | "title" | "domain">) =>
  ({ loggedAt: AT, ...over }) satisfies CynefinItem;

const ITEMS: CynefinItem[] = [
  item({
    id: "c1",
    title: "New onboarding flow",
    domain: "complex",
    rationale: "Only trying will tell.",
    answers: { known: "no", emergent: "yes" },
    sentTo: [{ route: "hypothesis", targetId: "h1", at: AT }],
  }),
  item({
    id: "c2",
    title: "Database sharding",
    domain: "complicated",
    rationale: "Our DBAs can work it out.",
    // The questions point to Complex; the team confirmed Complicated.
    answers: { known: "no", emergent: "yes" },
  }),
  item({
    id: "c3",
    title: "Password resets",
    domain: "clear",
    recommendedAction: "Use the support runbook.",
  }),
  item({ id: "c4", title: "Pricing page", domain: "complex", rationale: "Unknown demand." }),
];

// Running: being tested, no result yet.
const HYPOTHESES: Pick<Hypothesis, "id" | "status">[] = [{ id: "h1", status: "running" }];

describe("generateCynefinPrompts", () => {
  const [p] = generateCynefinPrompts({ items: ITEMS, hypotheses: HYPOTHESES }, null);

  it("says where a domain came from: suggested and confirmed, or placed by hand", () => {
    expect(p.prompt).toContain(
      "- Database sharding: Our DBAs can work it out. (the questions suggested Complex; the team confirmed Complicated)"
    );
    expect(p.prompt).toContain(
      "- New onboarding flow: Only trying will tell. (the questions suggested it and the team confirmed it; being tested)"
    );
    expect(p.prompt).toContain(
      "- Password resets: — (placed by hand; plan: Use the support runbook.)"
    );
  });

  it("gives each domain its recipe and each complex item its hypothesis state", () => {
    expect(p.prompt).toContain(
      "### Complex (2): Probe → Sense → Respond. Run safe-to-fail experiments."
    );
    expect(p.prompt).toContain(
      "- Pricing page: Unknown demand. (placed by hand; not yet a hypothesis)"
    );
    expect(p.prompt).toContain(`Verdict: ${cynefinVerdict(ITEMS, HYPOTHESES)}`);
    expect(p.prompt).not.toContain("### Chaotic");
  });

  it("keeps the board inside the untrusted block, and has nothing to ask about an empty one", () => {
    expect(p.prompt.indexOf("Database sharding")).toBeGreaterThan(
      p.prompt.indexOf("<user_content>")
    );
    expect(generateCynefinPrompts({ items: [] })).toEqual([]);
  });
});
