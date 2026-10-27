import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CynefinItem, Hypothesis, WhiteboardObject } from "@/lib/stores/workspace-types";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";
import {
  DOMAINS,
  classifySignals,
  complexNotTested,
  cynefinVerdict,
  hypothesisStateOf,
  hypothesisTitle,
  normalizeDomain,
  planOf,
  senseDomain,
} from "@/lib/cynefin/model";
import { registry } from "@/lib/actions/registry";

/**
 * Cynefin, upgraded (Phase 7): guided questions suggest a domain that the
 * team confirms (nothing lands in a domain by default); items are edited in
 * place and deleted with Undo; changing an item's domain keeps a plan
 * written for it; a complex item becomes a hypothesis to test (once, with
 * Undo) and shows where that test stands; an example, a verdict, Markdown,
 * and the agent saying the same.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { CynefinClient } from "@/app/(tools)/cynefin/cynefin-client";
import { buildExample } from "@/app/(tools)/cynefin/example";
import { cynefinToMarkdown } from "@/app/(tools)/cynefin/markdown";
import { validateSense } from "@/app/(tools)/cynefin/sense-form";
import "@/lib/actions/tools/cynefin";

const item = (over: Partial<CynefinItem> = {}): CynefinItem => ({
  id: "c1",
  title: "New pricing page",
  domain: "complex",
  loggedAt: "2026-10-20T09:00:00.000Z",
  ...over,
});
const hyp = (id: string, status: Hypothesis["status"]): Hypothesis => ({
  id,
  believe: "We believe x",
  willDo: "",
  toLearn: "",
  successMetric: "",
  status,
  raisedAt: "2026-10-20",
});

const ws = () => useWorkspaceStore.getState();
const items = () => ws().cynefinItems ?? [];
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const seed = (list: CynefinItem[], hs: Hypothesis[] = []) =>
  useWorkspaceStore.setState({
    cynefinItems: list,
    hypothesisTrackers: hs.length > 0 ? [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: hs }] : [],
    whiteboardObjects: [],
  });
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CynefinClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const answer = (question: RegExp, label: "Yes" | "No" | "Not sure") =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: question })).getByRole("radio", { name: label })
  );

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.cynefin.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  seed([]);
});

/* ── The rules (lib/cynefin/model) ──────────────────────────────────── */

describe("the guided questions suggest, they don't decide", () => {
  it.each([
    [{ crisis: "yes" }, "chaotic"],
    [{ crisis: "no", disagree: "yes" }, "confused"],
    [{ known: "yes", emergent: "yes" }, "confused"],
    [{ crisis: "no", known: "yes" }, "clear"],
    [{ known: "no", emergent: "yes" }, "complex"],
    [{ known: "no", analysable: "yes", emergent: "no" }, "complicated"],
    [{ known: "no", analysable: "no" }, "complex"],
    [{ known: "unsure", analysable: "unsure" }, null],
    [{ known: "no" }, null],
    [{}, null],
  ] as const)("%j → %s", (answers, domain) => {
    expect(senseDomain(answers).domain).toBe(domain);
  });

  it("explains itself, and ignores answers it doesn't know", () => {
    expect(senseDomain({ known: "no" }).reason).toBe(
      "Answer at least two questions for a suggestion."
    );
    expect(senseDomain({ crisis: "yes", bogus: "yes" }).answered).toBe(1);
    expect(senseDomain({ known: "no", analysable: "maybe" }).answered).toBe(1);
  });

  it("keeps the agents' keyword classifier as it was", () => {
    expect(classifySignals(["urgent", "experiment"]).recommendedDomain).toBe("chaotic");
    expect(classifySignals(["experiment", "expert"]).recommendedDomain).toBe("complex");
    expect(classifySignals(["expert", "routine"]).recommendedDomain).toBe("complicated");
    expect(classifySignals(["nothing here"])).toMatchObject({
      recommendedDomain: "confused",
      matched: false,
    });
  });

  it("reads a legacy domain as confused, and tells a written plan from a recipe copy", () => {
    expect(normalizeDomain("simple")).toBe("confused");
    expect(planOf(item({ recommendedAction: DOMAINS.clear.recipe }))).toEqual({
      text: DOMAINS.complex.recipe,
      custom: false,
    });
    expect(planOf(item({ recommendedAction: "Spike the auth flow" }))).toEqual({
      text: "Spike the auth flow",
      custom: true,
    });
    // The tracker labels the field "We believe": the title fills it, without the words again.
    expect(hypothesisTitle(" Customers churn ")).toBe("Customers churn");
    expect(hypothesisTitle("We believe X")).toBe("X");
    expect(hypothesisTitle("we believe that users want X")).toBe("that users want X");
    expect(hypothesisTitle("We believers")).toBe("We believers");
    expect(hypothesisTitle("We believe")).toBe("We believe");
  });

  it("knows where a complex item's test stands, and says it in the verdict", () => {
    const list = [
      item({ id: "a", sentTo: [{ route: "hypothesis", targetId: "h1", at: "" }] }),
      item({ id: "b", sentTo: [{ route: "hypothesis", targetId: "gone", at: "" }] }),
      item({ id: "c", domain: "chaotic" }),
    ];
    const hs = [hyp("h1", "running")];
    expect(hypothesisStateOf(list[0], hs)).toBe("testing");
    expect(hypothesisStateOf(list[0], [hyp("h1", "validated")])).toBe("tested");
    expect(hypothesisStateOf(list[1], hs)).toBe("none");
    expect(complexNotTested(list, hs).map((x) => x.id)).toEqual(["b"]);
    expect(cynefinVerdict(list, hs)).toBe(
      "3 items: 2 complex (1 not yet tested as a hypothesis), 1 chaotic: stabilise it first."
    );
    expect(cynefinVerdict([], hs)).toBe("No problems placed yet.");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("placing a problem", () => {
  it("refuses to file it until a domain is picked: no default", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Problem/), {
      target: { value: "Churn after pricing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Place it" }));
    expect(
      screen.getByText("Pick a domain, or answer the questions for a suggestion.")
    ).toBeInTheDocument();
    expect(items()).toEqual([]);
    expect(validateSense({ title: "x", answers: {}, domain: null, rationale: "" }).ok).toBe(false);
  });

  it("suggests from the answers; using the suggestion fills the domain and the reason", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Problem/), {
      target: { value: "Churn after pricing" },
    });
    answer(/known best practice/, "No");
    answer(/only learn what works/, "Yes");
    expect(screen.getByText(/Suggested:/)).toHaveTextContent(
      "Suggested: Complex, because you'll only learn"
    );
    fireEvent.click(screen.getByRole("button", { name: "Use the suggestion" }));
    fireEvent.click(screen.getByRole("button", { name: "Place it" }));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({
      title: "Churn after pricing",
      domain: "complex",
      answers: { known: "no", emergent: "yes" },
      rationale:
        "You'll only learn what works by trying something and watching: run safe-to-fail experiments.",
    });
    expect(items()[0].recommendedAction).toBeUndefined();
  });

  it("lets the team pick another domain than the suggestion", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Problem/), { target: { value: "Slow month-end" } });
    answer(/only learn what works/, "Yes");
    answer(/known best practice/, "No");
    fireEvent.click(screen.getByRole("radio", { name: "Complicated" }));
    fireEvent.click(screen.getByRole("button", { name: "Place it" }));
    expect(items()[0].domain).toBe("complicated");
  });
});

describe("items on the board", () => {
  it("changing the domain keeps a written plan, and lets a recipe copy follow", () => {
    seed([
      item({ id: "own", title: "Own plan", recommendedAction: "Spike the auth flow" }),
      item({ id: "copy", title: "Copied recipe", recommendedAction: DOMAINS.complex.recipe }),
    ]);
    renderPage();
    fireEvent.change(screen.getByLabelText("Domain of Own plan"), {
      target: { value: "complicated" },
    });
    fireEvent.change(screen.getByLabelText("Domain of Copied recipe"), {
      target: { value: "clear" },
    });
    expect(items().find((x) => x.id === "own")).toMatchObject({
      domain: "complicated",
      recommendedAction: "Spike the auth flow",
    });
    expect(items().find((x) => x.id === "copy")?.recommendedAction).toBeUndefined();
    expect(screen.getByText("custom plan")).toBeInTheDocument();
  });

  it("edits the title and the reason in place, and deletes with Undo", () => {
    seed([item({ rationale: "Nobody knows" })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New pricing page \(edit\)/ }));
    const box = screen.getByRole("textbox", { name: "Problem title" });
    fireEvent.change(box, { target: { value: "Pricing page churn" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(items()[0].title).toBe("Pricing page churn");

    fireEvent.click(screen.getByRole("button", { name: /Nobody knows\. Edit/ }));
    const why = screen.getByRole("textbox", { name: /^Why Pricing page churn is Complex/ });
    fireEvent.change(why, { target: { value: "Customers surprise us" } });
    fireEvent.blur(why);
    expect(items()[0].rationale).toBe("Customers surprise us");

    fireEvent.click(screen.getByRole("button", { name: "Delete Pricing page churn" }));
    expect(items()).toEqual([]);
    undoLast();
    expect(items().map((x) => x.id)).toEqual(["c1"]);
  });

  it("turns a complex item into a hypothesis once, with Undo, then shows the test's state", () => {
    seed([item({ rationale: "We can't predict how customers react" })]);
    const view = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Turn into a hypothesis" }));
    expect(hypotheses()).toHaveLength(1);
    expect(hypotheses()[0]).toMatchObject({
      believe: "New pricing page",
      toLearn: "We can't predict how customers react",
      status: "drafted",
      sourceRef: { tool: "cynefin", id: "c1" },
    });
    expect(items()[0].sentTo?.[0]).toMatchObject({
      route: "hypothesis",
      targetId: hypotheses()[0].id,
    });
    expect(
      screen.queryByRole("button", { name: "Turn into a hypothesis" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Testing in the Hypothesis Tracker/ })
    ).toBeInTheDocument();

    undoLast();
    expect(hypotheses()).toEqual([]);
    expect(items()[0].sentTo ?? []).toEqual([]);
    expect(screen.getByRole("button", { name: "Turn into a hypothesis" })).toBeInTheDocument();
    view.unmount();

    const id = "h9";
    seed(
      [item({ sentTo: [{ route: "hypothesis", targetId: id, at: "" }] })],
      [hyp(id, "invalidated")]
    );
    renderPage();
    expect(
      screen.getByRole("link", { name: /Tested in the Hypothesis Tracker/ })
    ).toBeInTheDocument();
  });

  it("loads the example (its items stay out of the tracker) and clears only it", () => {
    seed([item({ id: "mine", domain: "clear", title: "Mine" })]);
    renderPage();
    act(() => useWorkspaceStore.setState({ cynefinItems: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(items()).toHaveLength(6);
    for (const b of screen.getAllByRole("button", { name: "Turn into a hypothesis" }))
      expect(b).toBeDisabled();
    act(() => ws().upsertCynefinItem(item({ id: "mine", domain: "clear", title: "Mine" })));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(items().map((x) => x.id)).toEqual(["mine"]);
  });
});

describe("Markdown", () => {
  it("groups by domain with the recipe, reasons, answers and the hypothesis state", () => {
    const list = buildExample("2026-10-27T00:00:00.000Z");
    const md = cynefinToMarkdown(list, {
      verdict: cynefinVerdict(list, []),
      hypothesisOf: (it) => (it.id === "example-cy-pricing" ? "testing" : "none"),
    });
    expect(md).toContain(
      "# Cynefin board\n\n6 items: 2 complex, none yet tested as hypotheses, 1 complicated, 1 clear, 1 confused, 1 chaotic: stabilise it first."
    );
    expect(md).toContain("## Complex (2)");
    expect(md).toContain("_Probe → Sense → Respond. Run safe-to-fail experiments._");
    expect(md).toContain("  - Sent to the Hypothesis Tracker: being tested.");
    expect(md).toContain(
      "Is something going wrong right now that needs action before analysis? Yes"
    );
  });
});

/* ── The agent ──────────────────────────────────────────────────────── */

describe("the agent says the same", () => {
  it("list_state carries the page's verdict and what isn't being tested", async () => {
    seed(
      buildExample("2026-10-27T00:00:00.000Z").map((x) => ({
        ...x,
        id: x.id.replace("example-", ""),
      }))
    );
    renderPage();
    const state = await run<{
      verdict: string;
      complexNotTested: string[];
      complex: { plan: string }[];
    }>("list_state");
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
    expect(state.complexNotTested).toEqual(["cy-pricing", "cy-onboarding"]);
    expect(state.complex[0].plan).toBe(DOMAINS.complex.recipe);
  });

  it("classify suggests from answers first, as the page does", async () => {
    const out = await run<{ recommendedDomain: string | null; from: string }>("classify", {
      title: "x",
      signals: ["urgent"],
      answers: { known: "no", analysable: "no" },
    });
    expect(out).toMatchObject({ recommendedDomain: "complex", from: "answers" });
    const none = await run<{ recommendedDomain: string | null }>("classify", {
      title: "x",
      answers: { known: "no" },
    });
    expect(none.recommendedDomain).toBeNull();
  });

  it("record_domain needs the confirmed domain; moves keep a written plan", async () => {
    const action = registry.get("tool.cynefin.record_domain")!;
    expect(action.paramsSchema.safeParse({ title: "No domain" }).success).toBe(false);
    const made = await run<{ id: string; created: boolean }>("record_domain", {
      title: "Checkout down",
      domain: "chaotic",
      answers: { crisis: "yes" },
    });
    expect(made.created).toBe(true);
    expect(items()[0]).toMatchObject({ domain: "chaotic", answers: { crisis: "yes" } });
    expect(items()[0].rationale).toBeUndefined();
    await run("set_recommended_action", { id: made.id, recommendedAction: "Roll back first" });
    await run("record_domain", { id: made.id, domain: "complicated" });
    expect(items()[0]).toMatchObject({
      domain: "complicated",
      recommendedAction: "Roll back first",
    });
  });

  it("classify_and_persist no longer invents a rationale for an explicit domain", async () => {
    await run("classify_and_persist", { title: "Explicit", domain: "clear" });
    expect(items()[0].rationale).toBeUndefined();
    await run("classify_and_persist", {
      title: "From answers",
      answers: { known: "no", emergent: "yes" },
    });
    expect(items()[1]).toMatchObject({
      domain: "complex",
      answers: { known: "no", emergent: "yes" },
    });
    const refused = await run<{ persisted: boolean }>("classify_and_persist", {
      title: "Unclear",
      answers: { known: "no" },
    });
    expect(refused.persisted).toBe(false);
  });

  it("send_to_hypothesis: complex only, once", async () => {
    seed([item(), item({ id: "c2", domain: "clear", title: "Clear one" })]);
    expect(await run("send_to_hypothesis", { id: "c2" })).toEqual({
      sent: false,
      reason: "not_complex",
    });
    const sent = await run<{ sent: boolean; hypothesisId: string; believe: string }>(
      "send_to_hypothesis",
      { id: "c1" }
    );
    expect(sent.sent).toBe(true);
    // Under the tracker's own "We believe" label: the title as typed.
    expect(sent.believe).toBe("New pricing page");
    expect(hypotheses()[0].believe).toBe("New pricing page");
    expect(hypotheses().map((h) => h.id)).toEqual([sent.hypothesisId]);
    expect(items()[0].sentTo?.[0].targetId).toBe(sent.hypothesisId);
    expect(await run("send_to_hypothesis", { id: "c1" })).toMatchObject({
      sent: false,
      reason: "already_sent",
    });
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

describe("review fixes", () => {
  it("classify_and_persist files nothing when no signal matches (no default domain)", async () => {
    const refused = await run<{ persisted: boolean; reason: string; message: string }>(
      "classify_and_persist",
      { title: "Something", signals: ["totally unrelated text"] }
    );
    expect(refused).toMatchObject({ persisted: false, reason: "no_suggestion" });
    expect(refused.message).toMatch(/record_domain/);
    expect(items()).toEqual([]);
    // A matching signal still files its domain, and Confused only when a signal says so.
    expect(
      await run("classify_and_persist", { title: "Outage", signals: ["urgent"] })
    ).toMatchObject({ domain: "chaotic" });
    expect(
      await run("classify_and_persist", { title: "Stuck", signals: ["no agreement"] })
    ).toMatchObject({ domain: "confused" });
    // classify (pure) still reports its fallback, unmatched.
    expect(classifySignals(["totally unrelated text"]).matched).toBe(false);
  });

  it("the verdict tells tested complex items from ones being tested", () => {
    const sent = (id: string, h: string) =>
      item({ id, sentTo: [{ route: "hypothesis", targetId: h, at: "" }] });
    const list = [sent("a", "h1"), sent("b", "h2"), sent("c", "h3")];
    expect(
      cynefinVerdict(list, [hyp("h1", "validated"), hyp("h2", "running"), hyp("h3", "drafted")])
    ).toBe("3 items: 3 complex: 1 tested, 2 being tested.");
    expect(
      cynefinVerdict(list, [
        hyp("h1", "validated"),
        hyp("h2", "invalidated"),
        hyp("h3", "inconclusive"),
      ])
    ).toBe("3 items: 3 complex, all tested.");
    expect(
      cynefinVerdict(list, [hyp("h1", "running"), hyp("h2", "running"), hyp("h3", "running")])
    ).toBe("3 items: 3 complex, all being tested.");
    expect(cynefinVerdict([list[0]], [hyp("h1", "validated")])).toBe("1 item: 1 complex, tested.");
  });

  it("deleting an item moves focus to its neighbour, and the last one to the form", () => {
    seed([
      item({ id: "a", title: "First", domain: "clear" }),
      item({ id: "b", title: "Second", domain: "complex" }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));
    expect(screen.getByRole("button", { name: "Delete Second" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    expect(screen.getByLabelText(/^Problem/)).toHaveFocus();
  });

  it("moving an item to another domain keeps focus on its domain picker", () => {
    seed([item({ id: "a", title: "Mover", domain: "clear" })]);
    renderPage();
    fireEvent.change(screen.getByLabelText("Domain of Mover"), { target: { value: "complex" } });
    expect(items()[0].domain).toBe("complex");
    expect(screen.getByLabelText("Domain of Mover")).toHaveFocus();
  });

  it("'Use the suggestion' hands focus to the Domain it picked; a hypothesis to its link", () => {
    seed([item({ id: "c1", title: "Pricing" })]);
    renderPage();
    answer(/known best practice/, "No");
    answer(/only learn what works/, "Yes");
    fireEvent.click(screen.getByRole("button", { name: "Use the suggestion" }));
    const domain = screen.getByRole("radiogroup", { name: "Domain" });
    expect(within(domain).getByRole("radio", { name: /Complex/ })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Turn into a hypothesis" }));
    expect(screen.getByRole("link", { name: /Testing in the Hypothesis Tracker/ })).toHaveFocus();
  });

  it("Undo of a delete pins the item's canvas cards back", () => {
    const card = (id: string, sourceRef?: { tool: string; entityId: string }) =>
      ({
        id,
        boardId: "b",
        type: "card",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        z: 0,
        version: 1,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        title: "Card",
        ...(sourceRef ? { sourceRef } : {}),
      }) as unknown as WhiteboardObject;
    seed([item()]);
    act(() =>
      useWorkspaceStore.setState({
        whiteboardObjects: [card("k1", { tool: "cynefin", entityId: "c1" })],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete New pricing page" }));
    expect(ws().whiteboardObjects?.[0].sourceRef).toBeUndefined();
    undoLast();
    expect(ws().whiteboardObjects?.[0].sourceRef).toEqual({ tool: "cynefin", entityId: "c1" });
    expect(ws().whiteboardObjects?.[0].version).toBe(3);
  });
});
