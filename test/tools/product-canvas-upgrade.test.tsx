import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ENTITY_ROW_MAX_BYTES,
  type ProductCanvas,
  type ProductCanvasItem,
  type ProductGoal,
} from "@/lib/stores/workspace-types";

/**
 * Product Canvas (P2.3a): a product idea on one page as a Vision Board, a
 * Value Proposition, a Lean UX canvas or a PR/FAQ. The empty state's format
 * cards, a new canvas, each format's boxes and its own panel (the pitch, the
 * fit, the hypothesis builder, the press release check), lines added,
 * edited and deleted with Undo, facts and guesses, guesses and hypotheses
 * sent to the Hypothesis Tracker with Undo, the vision copied either way,
 * Ask Amr's draft and gaps with no AI (accept one or all, Replace without
 * "all", a gap kept as a question), the example (notice, clear, never sent
 * or logged, its own goal line), the links in, the Markdown and the row
 * guard.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/product-canvas",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { ProductCanvasClient } from "@/app/(tools)/product-canvas/product-canvas-client";
import { buildExample } from "@/app/(tools)/product-canvas/example";
import { canvasToMarkdown } from "@/app/(tools)/product-canvas/markdown";
import { useProductCanvasPrefs } from "@/app/(tools)/product-canvas/store";
import { validateNewCanvas } from "@/app/(tools)/product-canvas/new-canvas-form";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { readCanvas } from "@/lib/product-canvas/model";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/** jsdom has no ResizeObserver; the send menu's popper measures with one. */
function stubResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

beforeAll(async () => {
  // The format panels load with their canvas (next/dynamic): warm them.
  await Promise.all([
    import("@/app/(tools)/product-canvas/panels/vision-panel"),
    import("@/app/(tools)/product-canvas/panels/fit-panel"),
    import("@/app/(tools)/product-canvas/panels/hypotheses-panel"),
    import("@/app/(tools)/product-canvas/panels/press-release-panel"),
  ]);
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().productCanvases ?? [];
const byId = (id: string) => readCanvas(stored().find((c) => c.id === id));
const actions = () => logs.map((l) => l.action);
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];

/** The newest toast's Undo. */
function undoLast() {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error("no Undo toast");
  act(() => opts.action!.onClick());
}

const STAMP = "2026-11-20T09:00:00.000Z";
const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});
const canvas = (
  over: Partial<ProductCanvas> & Pick<ProductCanvas, "id" | "format">
): ProductCanvas => ({
  title: "Tapline",
  sections: {},
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Shop owners take every payment on their own phone.",
  why: "Card machines cost too much.",
  measures: ["Shops with no card machine: 40% to 70%"],
  status: "active",
  createdAt: STAMP,
  updatedAt: STAMP,
};

function seed(...canvases: ProductCanvas[]) {
  useWorkspaceStore.setState({ productCanvases: canvases });
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <ProductCanvasClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** Type into a field and press Enter. */
function enter(label: string, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: "Enter" });
}
/** Blur-commit a field. */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

beforeEach(() => {
  stubResizeObserver();
  logs.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/product-canvas");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    productCanvases: [],
    productGoals: [],
    hypothesisTrackers: [],
    stories: [],
  });
  useProductCanvasPrefs.setState({ lastFormat: "" });
  useProductGoalPrefs.setState({ vision: "" });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("empty state and new canvases", () => {
  it("offers a card per format, and the example", () => {
    renderPage();
    expect(screen.getByText(/No canvas yet/)).toBeInTheDocument();
    const cards = screen.getByRole("list", { name: "Formats" });
    for (const name of ["Vision Board", "Value Proposition", "Lean UX canvas", "PR/FAQ"]) {
      expect(within(cards).getByRole("button", { name: `Start a ${name}` })).toBeInTheDocument();
    }
    // P2.3b's formats aren't offered yet.
    expect(within(cards).queryByText(/Shape Up|business case|idea/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Load an example/ })).toBeInTheDocument();
  });

  it("starts a canvas from a format card, refusing a blank name, and logs it", () => {
    useWorkspaceStore.setState({ productGoals: [goal] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start a Lean UX canvas" }));
    expect(screen.getByRole("button", { name: "Lean UX canvas" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Start the canvas" }));
    expect(screen.getByText("Give the canvas a name.")).toBeInTheDocument();
    expect(stored()).toEqual([]);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Offline queue" } });
    fireEvent.click(screen.getByRole("button", { name: "Start the canvas" }));
    expect(stored()).toHaveLength(1);
    const c = stored()[0];
    expect(c).toMatchObject({ format: "lean-ux", title: "Offline queue", productGoalId: "goal_1" });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_CREATED,
      payload: { canvasId: c.id, format: "lean-ux" },
    });
    expect(screen.getByRole("heading", { name: /Offline queue/ })).toBeInTheDocument();
  });

  it.each([
    ["Vision Board", "vision-board", "The vision"],
    ["Value Proposition", "value-proposition", "The customer group"],
    ["Lean UX canvas", "lean-ux", "Business problem"],
    ["PR/FAQ", "pr-faq", "Headline"],
  ] as const)(
    "starts a %s from New canvas beside the list, with its own boxes",
    (name, format, lead) => {
      seed(canvas({ id: "pcanvas_old", format: "vision-board", title: "Older" }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "New canvas" }));
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: `My ${name}` } });
      fireEvent.click(screen.getByRole("button", { name: "Start the canvas" }));
      const made = stored().find((c) => c.id !== "pcanvas_old")!;
      expect(made).toMatchObject({ format, title: `My ${name}` });
      expect(made.productGoalId).toBeUndefined();
      expect(screen.getByRole("heading", { name: new RegExp(`My ${name}`) })).toBeInTheDocument();
      expect(screen.getByLabelText(lead)).toBeInTheDocument();
    }
  );

  it("validates a new canvas: a name and a format", () => {
    expect(validateNewCanvas({ title: "", format: "" })).toEqual({
      ok: false,
      errors: { title: "Give the canvas a name.", format: "Pick a format." },
    });
    expect(validateNewCanvas({ title: " Tapline ", format: "pr-faq" })).toEqual({
      ok: true,
      values: { title: "Tapline", format: "pr-faq" },
    });
  });
});

describe("boxes", () => {
  beforeEach(() => seed(canvas({ id: "pcanvas_vb", format: "vision-board" })));

  it("adds a line with Enter, as a guess in a fact-or-guess box, and logs the box", () => {
    renderPage();
    enter("Add to Who it's for", "Stall holders at weekend markets");
    expect(byId("pcanvas_vb")!.sections.who).toEqual([
      expect.objectContaining({ text: "Stall holders at weekend markets", evidence: "assumption" }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_vb", section: "who" },
    });
  });

  it("marks a line a fact, and edits it in place", () => {
    seed(
      canvas({
        id: "pcanvas_vb",
        format: "vision-board",
        sections: { who: [item("w1", "Cleaners", { evidence: "assumption" })] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByLabelText("Fact"));
    expect(byId("pcanvas_vb")!.sections.who[0].evidence).toBe("fact");
    fireEvent.click(screen.getByRole("button", { name: /^Cleaners/ }));
    const editor = screen.getByLabelText("Line");
    fireEvent.change(editor, { target: { value: "Mobile cleaners" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(byId("pcanvas_vb")!.sections.who[0]).toMatchObject({
      text: "Mobile cleaners",
      evidence: "fact",
    });
  });

  it("deletes a line with Undo", () => {
    seed(
      canvas({
        id: "pcanvas_vb",
        format: "vision-board",
        sections: { needs: [item("n1", "Take a card")] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Take a card”" }));
    expect(byId("pcanvas_vb")!.sections.needs).toEqual([]);
    undoLast();
    expect(byId("pcanvas_vb")!.sections.needs).toEqual([item("n1", "Take a card")]);
  });

  it("sets a one-line box when the field is left", () => {
    renderPage();
    commit(screen.getByLabelText("The vision"), "Small shops take payments anywhere.");
    expect(byId("pcanvas_vb")!.sections.vision[0].text).toBe("Small shops take payments anywhere.");
  });

  it("says why a write is refused when the canvas would pass one row", () => {
    seed(
      canvas({
        id: "pcanvas_vb",
        format: "vision-board",
        sections: {
          who: [
            item("w1", "Cleaners", {
              sentTo: [
                { route: "hypothesis", targetId: "t".repeat(ENTITY_ROW_MAX_BYTES), at: STAMP },
              ],
            }),
          ],
        },
      })
    );
    renderPage();
    enter("Add to What they need", "Take a card");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This product canvas is too big to save. Shorten or remove some lines. Nothing was saved."
    );
    expect(byId("pcanvas_vb")!.sections.needs).toBeUndefined();
  });

  it("lists what the canvas still lacks in the Check panel", () => {
    renderPage();
    const check = screen.getByRole("list", { name: "What the canvas still lacks" });
    expect(within(check).getByText('"The vision" is empty.')).toBeInTheDocument();
  });
});

describe("the Vision Board", () => {
  const vb = () =>
    canvas({
      id: "pcanvas_vb",
      format: "vision-board",
      sections: {
        "pitch-name": [item("pn", "Tapline")],
        "pitch-who": [item("pw", "Stall holders")],
        "pitch-benefit": [item("pb", "Take cards on their phone")],
        "pitch-difference": [item("pd", "It is seamless")],
      },
    });

  it("writes the pitch live, with Copy and a jargon note", async () => {
    seed(vb());
    renderPage();
    expect(
      await screen.findByText(
        "Tapline helps stall holders take cards on their phone. Tapline is different because it is seamless."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy the pitch" })).toBeInTheDocument();
    expect(screen.getByText(/It says “seamless”/)).toBeInTheDocument();
  });

  it("starts the vision from the Product Goal page's, with Undo", async () => {
    seed(vb());
    useProductGoalPrefs.setState({ vision: "Every shop takes payments anywhere." });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Start from the Product Goal’s vision" })
    );
    expect(byId("pcanvas_vb")!.sections.vision[0].text).toBe("Every shop takes payments anywhere.");
    undoLast();
    expect(byId("pcanvas_vb")!.sections.vision).toEqual([]);
  });

  it("saves the canvas's vision as the product vision, with Undo", async () => {
    seed({
      ...vb(),
      sections: { ...vb().sections, vision: [item("v", "Shops take payments anywhere.")] },
    });
    useProductGoalPrefs.setState({ vision: "The old vision." });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Use as the product vision" }));
    expect(useProductGoalPrefs.getState().vision).toBe("Shops take payments anywhere.");
    undoLast();
    expect(useProductGoalPrefs.getState().vision).toBe("The old vision.");
  });
});

describe("the Value Proposition", () => {
  const vp = () =>
    canvas({
      id: "pcanvas_vp",
      format: "value-proposition",
      title: "Stall holders",
      sections: {
        pains: [item("p1", "No signal in the hall", { evidence: "fact" })],
        eases: [item("e1", "Takes the payment offline")],
      },
    });

  it("shows the customer side before the offer side", () => {
    seed(vp());
    renderPage();
    const customer = screen.getByRole("heading", { name: "The customer" });
    const offer = screen.getByRole("heading", { name: "What we offer" });
    expect(customer.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links an ease to the pain it eases, and the fit meter counts it", async () => {
    seed(vp());
    renderPage();
    expect(await screen.findByText("Pains eased")).toBeInTheDocument();
    expect(screen.getByText("Pains eased").nextElementSibling).toHaveTextContent("0 of 1");
    fireEvent.click(screen.getByRole("checkbox", { name: "No signal in the hall" }));
    expect(byId("pcanvas_vp")!.sections.eases[0].links).toEqual(["p1"]);
    expect(screen.getByText("Pains eased").nextElementSibling).toHaveTextContent("1 of 1");
    expect(screen.getByText("Fit is a guess until customers tell you.")).toBeInTheDocument();
  });

  it("links the ease to a deleted pain again when its delete is undone", async () => {
    seed(
      canvas({
        id: "pcanvas_vp",
        format: "value-proposition",
        sections: {
          pains: [
            item("p1", "No signal in the hall", { evidence: "fact" }),
            item("p2", "Card machines cost too much"),
          ],
          eases: [item("e1", "Takes the payment offline", { links: ["p1", "p2"] })],
        },
      })
    );
    renderPage();
    expect(await screen.findByText("Pains eased")).toBeInTheDocument();
    expect(screen.getByText("Pains eased").nextElementSibling).toHaveTextContent("2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Delete “No signal in the hall”" }));
    expect(byId("pcanvas_vp")!.sections.eases[0].links).toEqual(["p2"]);
    expect(screen.getByText("Pains eased").nextElementSibling).toHaveTextContent("1 of 1");
    undoLast();
    expect(byId("pcanvas_vp")!.sections.pains.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(byId("pcanvas_vp")!.sections.eases[0].links).toEqual(["p1", "p2"]);
    expect(screen.getByText("Pains eased").nextElementSibling).toHaveTextContent("2 of 2");
    expect(screen.getByRole("checkbox", { name: "No signal in the hall" })).toBeChecked();
  });
});

describe("the Lean UX canvas", () => {
  const lean = (over: Partial<ProductCanvas["sections"]> = {}) =>
    canvas({
      id: "pcanvas_lx",
      format: "lean-ux",
      title: "Offline queue",
      sections: {
        outcomes: [item("o1", "more payments with no signal")],
        users: [item("u1", "Stall holders")],
        benefits: [item("b1", "keep selling")],
        solutions: [item("s1", "an offline queue")],
        ...over,
      },
    });

  it("builds a hypothesis from four picks, linked to them", async () => {
    seed(lean());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Build a hypothesis" })).toBeInTheDocument();
    for (const name of [
      "more payments with no signal",
      "Stall holders",
      "keep selling",
      "an offline queue",
    ]) {
      fireEvent.click(screen.getByRole("radio", { name }));
    }
    expect(
      screen.getByText(
        "Stall holders will keep selling with an offline queue, and we'll see more payments with no signal."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add the hypothesis" }));
    expect(byId("pcanvas_lx")!.sections.hypotheses).toEqual([
      expect.objectContaining({
        text: "Stall holders will keep selling with an offline queue, and we'll see more payments with no signal.",
        links: ["u1", "b1", "s1", "o1"],
      }),
    ]);
  });

  it("sends a hypothesis to the Hypothesis Tracker with its test, with Undo, and shows how it stands", () => {
    seed(
      lean({
        hypotheses: [
          item("h1", "Stall holders will keep selling", { links: ["u1", "b1", "s1", "o1"] }),
        ],
        "smallest-test": [item("t1", "Ten stalls for two weekends", { links: ["h1"] })],
      })
    );
    renderPage();
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^Send to… Stall holders will keep selling/ }),
      { key: "Enter" }
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Hypothesis to test" }));
    expect(hypotheses()).toEqual([
      expect.objectContaining({
        believe: "Stall holders will keep selling",
        willDo: "an offline queue",
        experiment: "Ten stalls for two weekends",
        successMetric: "more payments with no signal",
        sourceRef: { tool: "product-canvas", id: "h1", doc: "pcanvas_lx" },
      }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.ITEM_SENT,
      payload: { canvasId: "pcanvas_lx", section: "hypotheses", route: "hypothesis" },
    });
    expect(
      screen.getByRole("link", { name: "Drafted in the Hypothesis Tracker" })
    ).toBeInTheDocument();
    undoLast();
    expect(hypotheses()).toEqual([]);
    expect(byId("pcanvas_lx")!.sections.hypotheses[0].sentTo).toBeUndefined();
  });

  it("gives a hypothesis its pick back, and a test its hypothesis, when a delete is undone", () => {
    seed(
      lean({
        hypotheses: [
          item("h1", "Stall holders will keep selling", { links: ["u1", "b1", "s1", "o1"] }),
        ],
        "learn-first": [item("l1", "Ask ten stalls", { links: ["h1"] })],
        "smallest-test": [item("t1", "Ten stalls for two weekends", { links: ["h1"] })],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete “an offline queue”" }));
    expect(byId("pcanvas_lx")!.sections.hypotheses[0].links).toEqual(["u1", "b1", "o1"]);
    expect(screen.getByText("Solution: gone")).toBeInTheDocument();
    undoLast();
    expect(byId("pcanvas_lx")!.sections.solutions).toEqual([item("s1", "an offline queue")]);
    expect(byId("pcanvas_lx")!.sections.hypotheses[0].links).toEqual(["u1", "b1", "s1", "o1"]);
    expect(screen.getByText("Solution: an offline queue")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete “Stall holders will keep selling”" })
    );
    expect(byId("pcanvas_lx")!.sections["learn-first"][0].links).toBeUndefined();
    expect(byId("pcanvas_lx")!.sections["smallest-test"][0].links).toBeUndefined();
    undoLast();
    expect(byId("pcanvas_lx")!.sections.hypotheses[0]).toEqual(
      item("h1", "Stall holders will keep selling", { links: ["u1", "b1", "s1", "o1"] })
    );
    expect(byId("pcanvas_lx")!.sections["learn-first"][0].links).toEqual(["h1"]);
    expect(byId("pcanvas_lx")!.sections["smallest-test"][0].links).toEqual(["h1"]);
    expect(screen.getByText("Has a learn-first")).toBeInTheDocument();
    expect(screen.getByText("Has a smallest test")).toBeInTheDocument();
  });
});

describe("the PR/FAQ", () => {
  const pr = (over: Partial<ProductCanvas["sections"]> = {}) =>
    canvas({
      id: "pcanvas_pr",
      format: "pr-faq",
      title: "Launch news",
      sections: {
        headline: [item("h", "Tapline lets stall holders take cards")],
        ...over,
      },
    });

  it("counts the press release's words and flags a launch date that has passed", async () => {
    seed(pr({ "launch-date": [item("d", "2020-01-01")] }));
    renderPage();
    expect(await screen.findByText(/^6 words\./)).toBeInTheDocument();
    // The panel and the Check panel both say so.
    expect(
      screen.getAllByText("The launch date 2020-01-01 has passed. Move it, or say what launched.")
    ).toHaveLength(2);
  });

  it("refuses a typed launch date in the past", () => {
    seed(pr());
    renderPage();
    commit(screen.getByLabelText("Launch date"), "2020-01-01");
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a day still ahead");
    expect(byId("pcanvas_pr")!.sections["launch-date"]).toBeUndefined();
  });

  it("adds a hard question to the internal questions, then counts its answer", async () => {
    seed(pr());
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add to internal questions: What will it cost to build, and to keep running?",
      })
    );
    const added = byId("pcanvas_pr")!.sections["internal-faq"][0];
    expect(added).toMatchObject({
      text: "What will it cost to build, and to keep running?",
      promptId: "hq-cost",
    });
    expect(screen.getByText("Hard questions: 1 of 8 asked, 0 answered")).toBeInTheDocument();
    commit(
      screen.getByLabelText("Answer to “What will it cost to build, and to keep running?”"),
      "Two people for a quarter."
    );
    expect(byId("pcanvas_pr")!.sections["internal-faq"][0].detail).toBe(
      "Two people for a quarter."
    );
    expect(screen.getByText("Hard questions: 1 of 8 asked, 1 answered")).toBeInTheDocument();
  });
});

describe("sending a guess", () => {
  it("sends a guess to be tested, with the canvas named, and logs the send", () => {
    seed(
      canvas({
        id: "pcanvas_vb",
        format: "vision-board",
        sections: { needs: [item("n1", "We believe buyers want cards")] },
      })
    );
    renderPage();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send to… buyers want cards/ }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Test this guess" }));
    expect(hypotheses()).toEqual([
      expect.objectContaining({
        believe: "buyers want cards",
        sourceRef: { tool: "product-canvas", id: "n1", doc: "pcanvas_vb" },
      }),
    ]);
    expect(actions()).toContain(PRODUCT_CANVAS_ACTIONS.ITEM_SENT);
  });

  it("offers no send on a fact, and none while a [placeholder] is left", () => {
    seed(
      canvas({
        id: "pcanvas_vb",
        format: "vision-board",
        sections: {
          who: [item("w1", "Cleaners", { evidence: "fact" })],
          needs: [item("n1", "They need to [do what]")],
        },
      })
    );
    renderPage();
    expect(screen.queryByRole("button", { name: /^Send to… Cleaners/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Send to… They need to/ })).toBeDisabled();
  });
});

describe("Ask Amr, with no AI", () => {
  it("drafts from the goal and starter lines; Add all lands them as guesses, with one Undo", async () => {
    useWorkspaceStore.setState({ productGoals: [goal] });
    seed(canvas({ id: "pcanvas_lx", format: "lean-ux", title: "Queue" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /^Add all/ }));
    const c = byId("pcanvas_lx")!;
    expect(c.sections.problem[0].text).toBe(goal.why);
    expect(c.sections.outcomes.map((i) => i.text)).toEqual(goal.measures);
    expect(c.sections.users[0]).toMatchObject({ evidence: "assumption" });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.DRAFT_ACCEPTED,
      payload: expect.objectContaining({ canvasId: "pcanvas_lx", source: "starter" }),
    });
    undoLast();
    const back = byId("pcanvas_lx")!;
    expect(Object.values(back.sections).flat()).toEqual([]);
  });

  it("offers Amr's other wording for a filled box only as Replace, one at a time, with Undo", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              items: [
                { section: "users", text: "Stall holders in market halls" },
                { section: "nope", text: "A box the canvas lacks" },
              ],
              fields: [{ id: "problem", text: "Sales are lost when there is no signal." }],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed(
      canvas({
        id: "pcanvas_lx",
        format: "lean-ux",
        sections: { problem: [item("p", "Our own words")] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr to draft" }));
    const lists = await screen.findAllByTestId("ai-suggestions");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lists).toHaveLength(2);
    const [lines, replace] = lists;
    expect(
      within(lines).getByText("Suggested by Amr's AI. Check before you add.")
    ).toBeInTheDocument();
    expect(within(lines).queryByText("A box the canvas lacks")).toBeNull();
    fireEvent.click(
      within(lines).getByRole("button", { name: /^Add: Stall holders in market halls/ })
    );
    expect(byId("pcanvas_lx")!.sections.users).toEqual([
      expect.objectContaining({ text: "Stall holders in market halls", evidence: "assumption" }),
    ]);
    expect(within(replace).getByText(/Now: Our own words/)).toBeInTheDocument();
    expect(within(replace).queryByRole("button", { name: /^Replace all/ })).toBeNull();
    fireEvent.click(within(replace).getByRole("button", { name: /^Replace: Sales are lost/ }));
    expect(byId("pcanvas_lx")!.sections.problem[0].text).toBe(
      "Sales are lost when there is no signal."
    );
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.DRAFT_ACCEPTED,
      payload: { canvasId: "pcanvas_lx", source: "ai", count: 1 },
    });
    undoLast();
    expect(byId("pcanvas_lx")!.sections.problem[0].text).toBe("Our own words");
  });

  it("says what to write first when there is nothing to draft from", () => {
    seed(canvas({ id: "pcanvas_lx", format: "lean-ux" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    expect(
      screen.getByText("Write the Product Goal, a short brief or one box first.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
  });

  it("keeps a gap found without AI as an open question, with Undo", async () => {
    seed(canvas({ id: "pcanvas_pr", format: "pr-faq" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Check without AI" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getAllByRole("button", { name: /^Keep as a question:/ })[0]);
    expect(byId("pcanvas_pr")!.sections.questions).toEqual([
      expect.objectContaining({ text: '"Headline" is empty.' }),
    ]);
    undoLast();
    expect(byId("pcanvas_pr")!.sections.questions).toEqual([]);
  });
});

describe("Ask Amr what's missing, with AI", () => {
  it("keeps a gap as an open question, one about a box the format lacks as about the canvas", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              gaps: [
                { section: "headline", text: "Does the headline name who it is for?" },
                { section: "nope", text: "Who would pay for this first?" },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed(
      canvas({
        id: "pcanvas_pr",
        format: "pr-faq",
        sections: { headline: [item("h", "Tapline launches", { owner: "Sam" })] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr what's missing" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The canvas goes as the gap rules read it: no owner's name.
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("product-canvas.gaps");
    expect(body).not.toContain("Sam");
    expect(within(list).getByText("Headline")).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole("button", { name: /^Keep as a question: Who would pay/ })
    );
    expect(byId("pcanvas_pr")!.sections.questions).toEqual([
      expect.objectContaining({ text: "Who would pay for this first?" }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_pr", section: "questions" },
    });
    undoLast();
    expect(byId("pcanvas_pr")!.sections.questions).toEqual([]);
  });
});

describe("the example", () => {
  it("loads one canvas per format with a notice, its own goal line, and clears", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(stored()).toHaveLength(4);
    expect(screen.getByText("The example’s Product Goal, not yours.")).toBeInTheDocument();
    expect(screen.getByText(/Shop owners take every in-person payment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(stored()).toEqual([]);
  });

  it("is never sent and never logged", () => {
    seed(...buildExample());
    renderPage();
    for (const b of screen.queryAllByRole("button", { name: /^Send to…/ }))
      expect(b).toBeDisabled();
    enter("Add to Open questions", "One more question");
    expect(actions()).toEqual([]);
  });

  it("holds what each format's panel shows", () => {
    const [vb, vp, lx, pr] = buildExample(new Date("2026-11-23T10:00:00Z")).map(
      (c) => readCanvas(c)!
    );
    expect(vb.sections["pitch-difference"][0].text).toMatch(/seamless/);
    expect(vp.sections.eases.flatMap((e) => e.links ?? [])).toHaveLength(2);
    expect(vp.sections.pains.find((p) => p.text.includes("signal"))?.evidence).toBe("fact");
    expect(lx.sections.hypotheses[0].links).toHaveLength(4);
    expect(lx.sections.hypotheses[0].text.length).toBeLessThanOrEqual(200);
    expect(pr.sections["launch-date"][0].text).toBe("2027-02-21");
    expect(pr.sections["internal-faq"].filter((i) => i.promptId)).toHaveLength(5);
    expect(pr.sections["internal-faq"].filter((i) => i.detail)).toHaveLength(3);
  });
});

describe("the page", () => {
  it("opens ?canvas=<id>, whatever the format filter", () => {
    seed(
      canvas({
        id: "pcanvas_a",
        format: "vision-board",
        title: "First",
        updatedAt: "2026-11-22T09:00:00.000Z",
      }),
      canvas({ id: "pcanvas_b", format: "pr-faq", title: "Second" })
    );
    useProductCanvasPrefs.setState({ lastFormat: "vision-board" });
    window.history.replaceState(null, "", "/product-canvas?canvas=pcanvas_b");
    renderPage();
    expect(screen.getByRole("heading", { name: /Second/ })).toBeInTheDocument();
    expect(useProductCanvasPrefs.getState().lastFormat).toBe("");
    expect(window.location.search).toBe("");
  });

  it("filters the list by ?format=", () => {
    seed(
      canvas({ id: "pcanvas_a", format: "vision-board", title: "First" }),
      canvas({ id: "pcanvas_b", format: "pr-faq", title: "Second" })
    );
    window.history.replaceState(null, "", "/product-canvas?format=pr-faq");
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Canvases" });
    expect(within(nav).queryByRole("button", { name: /^First/ })).toBeNull();
    expect(within(nav).getByRole("button", { name: /^Second/ })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: /^All/ }));
    expect(within(nav).getByRole("button", { name: /^First/ })).toBeInTheDocument();
  });

  it("shows the Product Goal at the top, and says when a canvas was drafted for an earlier one", () => {
    useWorkspaceStore.setState({ productGoals: [goal] });
    seed(canvas({ id: "pcanvas_a", format: "vision-board", productGoalId: "goal_old" }));
    renderPage();
    expect(screen.getByText(goal.statement)).toBeInTheDocument();
    expect(screen.getByText("Drafted for an earlier Product Goal.")).toBeInTheDocument();
    cleanup();
    seed(canvas({ id: "pcanvas_a", format: "vision-board", productGoalId: "goal_1" }));
    renderPage();
    expect(screen.queryByText("Drafted for an earlier Product Goal.")).toBeNull();
  });

  it("renames a canvas when its name field is left, refusing a blank name", () => {
    seed(canvas({ id: "pcanvas_a", format: "pr-faq", title: "First" }));
    renderPage();
    const field = screen.getByLabelText("Canvas name");
    commit(field, "Launch news");
    expect(byId("pcanvas_a")!.title).toBe("Launch news");
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_a", field: "title" },
    });
    logs.length = 0;
    commit(screen.getByLabelText("Canvas name"), "   ");
    expect(byId("pcanvas_a")!.title).toBe("Launch news");
    expect(logs).toEqual([]);
  });

  it("puts the Open questions after what the format works out, and the credit last", () => {
    const md = canvasToMarkdown(
      readCanvas(
        canvas({
          id: "pcanvas_vp",
          format: "value-proposition",
          sections: {
            pains: [item("p1", "No signal")],
            questions: [item("q1", "How many buyers carry no cash?")],
          },
        })
      )!
    );
    expect(md.indexOf("## Fit")).toBeLessThan(md.indexOf("## Open questions"));
    expect(md.indexOf("- How many buyers carry no cash?")).toBeGreaterThan(md.indexOf("## Fit"));
    expect(md.trim().endsWith("After Strategyzer's Value Proposition Canvas")).toBe(true);
    expect(md).toContain("Product Goal: not written yet");
  });

  it("deletes a canvas with Undo, and logs it", () => {
    seed(canvas({ id: "pcanvas_a", format: "vision-board", title: "First" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete canvas" }));
    expect(stored()).toEqual([]);
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_REMOVED,
      payload: { canvasId: "pcanvas_a", format: "vision-board" },
    });
    undoLast();
    expect(stored().map((c) => c.id)).toEqual(["pcanvas_a"]);
  });

  it("exports the open canvas as Markdown, facts and guesses marked, with its credit", () => {
    seed(
      canvas({
        id: "pcanvas_vp",
        format: "value-proposition",
        title: "Stall holders",
        sections: {
          pains: [
            item("p1", "No signal", { evidence: "fact" }),
            item("p2", "Rent", { evidence: "assumption" }),
          ],
          eases: [item("e1", "Works offline", { links: ["p1"] })],
        },
      })
    );
    renderPage();
    expect(exported.markdown).toContain("# Stall holders");
    expect(exported.markdown).toContain("Format: Value Proposition");
    expect(exported.markdown).toContain("- No signal (fact)");
    expect(exported.markdown).toContain("- Rent (guess)");
    expect(exported.markdown).toContain("- Works offline (eases: No signal)");
    expect(exported.markdown).toContain("1 of 2 pains eased");
    expect(exported.markdown.trim().endsWith("After Strategyzer's Value Proposition Canvas")).toBe(
      true
    );
  });

  it("writes a PR/FAQ as the press release, then its questions and answers", () => {
    const md = canvasToMarkdown(
      readCanvas(
        canvas({
          id: "pcanvas_pr",
          format: "pr-faq",
          title: "News",
          sections: {
            headline: [item("h", "Tapline launches")],
            "customer-faq": [item("q", "Offline?", { detail: "Yes." })],
          },
        })
      )!,
      { goal }
    );
    expect(md.indexOf("## Headline")).toBeLessThan(md.indexOf("## Customer questions"));
    expect(md).toContain("- Q: Offline? A: Yes.");
    expect(md).toContain(`Product Goal: ${goal.statement}`);
  });

  it("lays out a phone-first page: one column, sides stacked until wide", () => {
    seed(canvas({ id: "pcanvas_vp", format: "value-proposition" }));
    const { container } = renderPage();
    const sides = screen
      .getByRole("heading", { name: "The customer" })
      .closest("section")!.parentElement!;
    expect(sides.className).toContain("lg:grid-cols-2");
    expect(sides.className).not.toMatch(/(^|\s)grid-cols-2/);
    // No box grid splits a phone screen in two.
    expect(container.querySelectorAll("section .grid-cols-2")).toHaveLength(0);
  });
});
