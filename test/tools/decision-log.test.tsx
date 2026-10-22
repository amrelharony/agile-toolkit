import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision } from "@/lib/stores/workspace-types";

/**
 * Decision Log (ADR): the local ADR list (persisted under its own key), the
 * KPI strip, the editor, delete, and the Workspace import / push handlers.
 */

type Csv = { headers: string[]; rows: unknown[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const sync = vi.hoisted(() => ({
  imported: undefined as number | void | undefined,
  pushed: undefined as number | void | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
// The real button is a dropdown + window.confirm; the tool's own import /
// push handlers are what's under test, so expose them as plain buttons.
vi.mock("@/components/shared/workspace-sync-button", () => ({
  WorkspaceSyncButton: ({
    onImport,
    onPush,
  }: {
    onImport?: () => number | void;
    onPush?: () => number | void;
  }) => (
    <div>
      <button type="button" onClick={() => (sync.imported = onImport?.())}>
        Import from Workspace
      </button>
      <button type="button" onClick={() => (sync.pushed = onPush?.())}>
        Push to Workspace
      </button>
    </div>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { DecisionLogClient } from "@/app/(tools)/decision-log/decision-log-client";
import { DECISION_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

const KEY = "agile-toolkit:decision-log";

const adr = (id: string, title: string, over: Partial<Decision> = {}): Decision => ({
  id,
  title,
  context: "",
  decision: "",
  consequences: "",
  alternatives: [],
  status: "proposed",
  date: "2026-10-01",
  ...over,
});

const saved = (): Decision[] => JSON.parse(localStorage.getItem(KEY) ?? "[]");
const seed = (list: Decision[]) => localStorage.setItem(KEY, JSON.stringify(list));

/** KPI value for a status label ("proposed", "accepted", …). */
function kpi(label: string): string {
  const labelEl = screen
    .getAllByText(label)
    .find((el) => el.parentElement?.className.includes("uppercase"));
  if (!labelEl) throw new Error(`no KPI labelled ${label}`);
  return labelEl.parentElement!.nextElementSibling!.textContent ?? "";
}

/** The left-hand list row for an ADR title. */
const row = (title: string) => screen.getByText(title).closest("button")!;

function chooseStatus(label: string) {
  const trigger = screen.getByLabelText("Status");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

function commit(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

beforeEach(() => {
  localStorage.clear();
  exported.csv = undefined;
  sync.imported = undefined;
  sync.pushed = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ decisions: [], whiteboardObjects: [] });
});

describe("Decision Log — empty state", () => {
  it("shows the empty list, the no-selection hint, and zero for every status", async () => {
    render(<DecisionLogClient />);
    expect(await screen.findByText(/No ADRs yet/)).toBeInTheDocument();
    expect(screen.getByText("Select an ADR on the left to edit its details.")).toBeInTheDocument();
    for (const s of ["proposed", "accepted", "deprecated", "superseded"]) {
      expect(kpi(s)).toBe("0");
    }
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Decision Log — seeded list", () => {
  it("lists every ADR with its date and status, and counts statuses in the KPI strip", async () => {
    seed([
      adr("a", "Use Postgres", { status: "accepted" }),
      adr("b", "Adopt GraphQL"),
      adr("c", "", { status: "proposed" }),
      adr("d", "Drop SOAP", { status: "deprecated" }),
    ]);
    render(<DecisionLogClient />);
    expect(await screen.findByText("Use Postgres")).toBeInTheDocument();
    expect(screen.getByText("(untitled)")).toBeInTheDocument();
    expect(within(row("Use Postgres")).getByText("accepted")).toBeInTheDocument();
    expect(within(row("Use Postgres")).getByText("2026-10-01")).toBeInTheDocument();
    expect(kpi("proposed")).toBe("2");
    expect(kpi("accepted")).toBe("1");
    expect(kpi("deprecated")).toBe("1");
    expect(kpi("superseded")).toBe("0");
  });

  it("ignores an out-of-schema status in the KPI counts instead of showing NaN", async () => {
    seed([
      adr("a", "Legacy row", { status: "rejected" as Decision["status"] }),
      adr("b", "Good row"),
    ]);
    render(<DecisionLogClient />);
    await screen.findByText("Legacy row");
    expect(kpi("proposed")).toBe("1");
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  it("opens the clicked ADR in the editor and marks its row pressed", async () => {
    seed([
      adr("a", "Use Postgres", {
        context: "We need durable events",
        decision: "Postgres it is",
        consequences: "Ops owns backups",
        alternatives: ["Mongo — rejected", "Kafka — later"],
        status: "accepted",
        date: "2026-09-30",
      }),
      adr("b", "Adopt GraphQL"),
    ]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    expect(row("Use Postgres")).toHaveAttribute("aria-pressed", "true");
    expect(row("Adopt GraphQL")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Title")).toHaveValue("Use Postgres");
    expect(screen.getByLabelText("Context")).toHaveValue("We need durable events");
    expect(screen.getByLabelText("Decision")).toHaveValue("Postgres it is");
    expect(screen.getByLabelText("Consequences")).toHaveValue("Ops owns backups");
    expect(screen.getByLabelText("Alternatives considered (one per line)")).toHaveValue(
      "Mongo — rejected\nKafka — later"
    );
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("Status")).toHaveTextContent("accepted");
  });

  it("opens a legacy ADR with no date or alternatives without crashing", async () => {
    seed([
      {
        id: "old",
        title: "Old ADR",
        decision: "x",
        status: "proposed",
        date: null as unknown as string,
      },
    ]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Old ADR"));
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.getByLabelText("Alternatives considered (one per line)")).toHaveValue("");
    expect(screen.getByLabelText("Context")).toHaveValue("");
  });
});

describe("Decision Log — add / edit / delete", () => {
  it("New ADR prepends an untitled, proposed ADR dated today and opens it", async () => {
    seed([adr("a", "Use Postgres")]);
    render(<DecisionLogClient />);
    await screen.findByText("Use Postgres");
    fireEvent.click(screen.getByRole("button", { name: /New ADR/ }));

    const list = saved();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      title: "",
      status: "proposed",
      date: todayLocalISO(),
      alternatives: [],
    });
    expect(list[1].id).toBe("a");
    expect(row("(untitled)")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(kpi("proposed")).toBe("2");
    expect(history.log).toHaveBeenCalledWith(DECISION_ACTIONS.DECISION_ADDED, {
      decisionId: list[0].id,
    });
  });

  it("commits the title on blur (not per keystroke) and shows it in the list", async () => {
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByRole("button", { name: /New ADR/ }));
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "ADR-0001: Use Postgres" } });
    expect(saved()[0].title).toBe("");
    fireEvent.blur(title);
    expect(saved()[0].title).toBe("ADR-0001: Use Postgres");
    expect(row("ADR-0001: Use Postgres")).toBeInTheDocument();
  });

  it("commits the title when Enter is pressed", async () => {
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByRole("button", { name: /New ADR/ }));
    const title = screen.getByLabelText("Title");
    title.focus();
    fireEvent.change(title, { target: { value: "Enter commits" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(saved()[0].title).toBe("Enter commits");
  });

  it("saves context, decision and consequences, and lets a field be cleared", async () => {
    seed([adr("a", "Use Postgres", { context: "old context" })]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    commit("Decision", "We will use Postgres.");
    commit("Consequences", "Ops owns backups.");
    commit("Context", "");
    expect(saved()[0]).toMatchObject({
      decision: "We will use Postgres.",
      consequences: "Ops owns backups.",
      context: "",
    });
    expect(screen.getByLabelText("Context")).toHaveValue("");
  });

  it("stores alternatives one per line", async () => {
    seed([adr("a", "Use Postgres")]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    commit("Alternatives considered (one per line)", "Mongo — no joins\nKafka — overkill");
    expect(saved()[0].alternatives).toEqual(["Mongo — no joins", "Kafka — overkill"]);
    expect(exported.csv?.rows[0][7]).toBe("Mongo — no joins; Kafka — overkill");
  });

  it("changes the date immediately and allows clearing it", async () => {
    seed([adr("a", "Use Postgres")]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-31" } });
    expect(saved()[0].date).toBe("2026-12-31");
    expect(within(row("Use Postgres")).getByText("2026-12-31")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    expect(saved()[0].date).toBe("");
  });

  it("changes status from the editor, updating the badge, KPIs and the history log once", async () => {
    seed([adr("a", "Use Postgres"), adr("b", "Adopt GraphQL")]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    chooseStatus("superseded");

    expect(saved().find((d) => d.id === "a")?.status).toBe("superseded");
    expect(saved().find((d) => d.id === "b")?.status).toBe("proposed");
    expect(within(row("Use Postgres")).getByText("superseded")).toBeInTheDocument();
    expect(kpi("proposed")).toBe("1");
    expect(kpi("superseded")).toBe("1");
    const statusLogs = history.log.mock.calls.filter(
      ([action]) => action === DECISION_ACTIONS.STATUS_CHANGED
    );
    expect(statusLogs).toEqual([
      [
        DECISION_ACTIONS.STATUS_CHANGED,
        { decisionId: "a", title: "Use Postgres", from: "proposed", to: "superseded" },
      ],
    ]);
  });

  it("edits only the selected ADR when switching between ADRs", async () => {
    seed([adr("a", "Use Postgres"), adr("b", "Adopt GraphQL")]);
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Adopt GraphQL"));
    commit("Decision", "GraphQL for the BFF only");
    fireEvent.click(screen.getByText("Use Postgres"));
    expect(screen.getByLabelText("Title")).toHaveValue("Use Postgres");
    expect(screen.getByLabelText("Decision")).toHaveValue("");
    commit("Decision", "Postgres for events");
    const byId = Object.fromEntries(saved().map((d) => [d.id, d.decision]));
    expect(byId).toEqual({ a: "Postgres for events", b: "GraphQL for the BFF only" });
  });

  it("Delete ADR removes only that ADR, closes the editor and drops the workspace copy", async () => {
    seed([adr("a", "Use Postgres"), adr("b", "Adopt GraphQL")]);
    useWorkspaceStore.setState({ decisions: [adr("a", "Use Postgres"), adr("z", "Other")] });
    render(<DecisionLogClient />);
    fireEvent.click(await screen.findByText("Use Postgres"));
    fireEvent.click(screen.getByRole("button", { name: /Delete ADR/ }));

    expect(saved().map((d) => d.id)).toEqual(["b"]);
    expect(screen.queryByText("Use Postgres")).not.toBeInTheDocument();
    expect(screen.getByText("Select an ADR on the left to edit its details.")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().decisions.map((d) => d.id)).toEqual(["z"]);
    expect(history.log).toHaveBeenCalledWith(DECISION_ACTIONS.DECISION_REMOVED, {
      decisionId: "a",
      title: "Use Postgres",
    });
  });
});

describe("Decision Log — Workspace import / push", () => {
  it("imports only workspace ADRs that aren't already in the log, then reports 0", async () => {
    seed([adr("a", "Use Postgres")]);
    useWorkspaceStore.setState({
      decisions: [adr("a", "Use Postgres (workspace copy)"), adr("w", "From workspace")],
    });
    render(<DecisionLogClient />);
    await screen.findByText("Use Postgres");
    fireEvent.click(screen.getByRole("button", { name: "Import from Workspace" }));
    expect(sync.imported).toBe(1);
    expect(saved().map((d) => d.id)).toEqual(["w", "a"]);
    expect(saved()[1].title).toBe("Use Postgres");
    expect(screen.getByText("From workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import from Workspace" }));
    expect(sync.imported).toBe(0);
    expect(saved()).toHaveLength(2);
  });

  it("pushes only titled ADRs to the workspace and returns how many", async () => {
    seed([
      adr("a", "Use Postgres", { status: "accepted" }),
      adr("b", "   "),
      adr("c", "Adopt GraphQL"),
    ]);
    render(<DecisionLogClient />);
    await screen.findByText("Use Postgres");
    fireEvent.click(screen.getByRole("button", { name: "Push to Workspace" }));
    expect(sync.pushed).toBe(2);
    const ws = useWorkspaceStore.getState().decisions;
    expect(ws.map((d) => d.id).sort()).toEqual(["a", "c"]);
    expect(ws.find((d) => d.id === "a")?.status).toBe("accepted");
  });
});

describe("Decision Log — CSV export", () => {
  it("exports one row per ADR with blank optional fields and '; '-joined alternatives", async () => {
    seed([
      adr("a", "Use Postgres", {
        status: "accepted",
        context: undefined,
        consequences: undefined,
        alternatives: ["Mongo", "Kafka"],
      }),
      { ...adr("b", "No alternatives"), alternatives: undefined },
    ]);
    render(<DecisionLogClient />);
    await screen.findByText("Use Postgres");
    expect(exported.csv?.headers).toEqual([
      "ID",
      "Title",
      "Status",
      "Date",
      "Context",
      "Decision",
      "Consequences",
      "Alternatives",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["a", "Use Postgres", "accepted", "2026-10-01", "", "", "", "Mongo; Kafka"],
      ["b", "No alternatives", "proposed", "2026-10-01", "", "", "", ""],
    ]);
  });
});
