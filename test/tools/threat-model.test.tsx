import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Threat } from "@/lib/stores/workspace-types";
import { THREAT_MODEL_ACTIONS } from "@/lib/history/event-actions";

/**
 * Threat Model Registry: KPIs (open, critical, services, mitigation rate),
 * the per-service STRIDE matrix, the add form (service, category, severity
 * slider, optional text), per-row status / mitigation / description edits,
 * remove, defensive rendering of corrupt rows, and the CSV export.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Slider measures itself; Radix Select calls these. jsdom has none.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { ThreatModelClient } from "@/app/(tools)/threat-model/threat-model-client";

const TM_ID = "threatModel:current";
const TODAY = "2026-10-18";

const threat = (id: string, over: Partial<Threat> = {}): Threat => ({
  id,
  service: `svc-${id}`,
  category: "spoofing",
  severity: 3,
  status: "open",
  raisedAt: "2026-10-01",
  ...over,
});

const seed = (threats: Threat[]) =>
  useWorkspaceStore.setState({ threatModels: [{ id: TM_ID, threats }] });

const threats = () =>
  (useWorkspaceStore.getState().threatModels ?? []).find((d) => d.id === TM_ID)?.threats ?? [];

function kpi(label: string): string | null {
  const el = screen
    .getAllByText(label)
    .find((e) => e.parentElement?.className.includes("uppercase"));
  return el!.parentElement!.nextElementSibling!.textContent;
}

function chooseOption(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

const statusOrder = () =>
  screen
    .getAllByRole("combobox")
    .map((c) => c.getAttribute("aria-label"))
    .filter((l): l is string => !!l?.startsWith("Status for "))
    .map((l) => l.replace("Status for ", ""));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ threatModels: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Threat model: empty state", () => {
  it("shows zeroed KPIs, no matrix and the empty hint", () => {
    render(<ThreatModelClient />);
    expect(kpi("Open threats")).toBe("0");
    expect(kpi("Critical (4-5)")).toBe("0");
    expect(kpi("Services covered")).toBe("0");
    expect(kpi("Mitigation rate")).toBe("0%");
    expect(screen.queryByText("STRIDE coverage matrix")).not.toBeInTheDocument();
    expect(screen.getByText(/No threats logged yet/)).toBeInTheDocument();
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Threat model: KPIs and matrix", () => {
  const mixed = () => [
    threat("a", { service: "auth-api", category: "spoofing", severity: 5, status: "open" }),
    threat("b", { service: "auth-api", category: "tampering", severity: 4, status: "mitigating" }),
    threat("c", {
      service: "billing",
      category: "information_disclosure",
      severity: 2,
      status: "mitigated",
    }),
    threat("d", { service: "billing", category: "spoofing", severity: 5, status: "accepted" }),
    threat("e", { service: "search", category: "denial_of_service", severity: 1 }),
  ];

  it("derives open, critical, services and mitigation rate", () => {
    seed(mixed());
    render(<ThreatModelClient />);
    expect(kpi("Open threats")).toBe("2"); // a, e
    // Critical skips mitigated + accepted: a (5) and b (4).
    expect(kpi("Critical (4-5)")).toBe("2");
    expect(kpi("Services covered")).toBe("3");
    // Accepted is excluded from both sides: 1 mitigated of a, b, c, e.
    expect(kpi("Mitigation rate")).toBe("25%");
  });

  it("reports 0% (not NaN) when every threat is accepted", () => {
    seed([threat("a", { status: "accepted" }), threat("b", { status: "accepted" })]);
    render(<ThreatModelClient />);
    expect(kpi("Mitigation rate")).toBe("0%");
    expect(kpi("Open threats")).toBe("0");
  });

  it("counts threats per service and STRIDE category, services sorted", () => {
    seed(mixed());
    render(<ThreatModelClient />);
    const table = screen.getByRole("table");
    const rows = within(table)
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(rows).toEqual(["auth-api", "billing", "search"]);
    const counts = (svc: string) =>
      within(within(table).getByRole("rowheader", { name: svc }).closest("tr")!)
        .getAllByRole("cell")
        .map((c) => (c.textContent === "—0" ? 0 : Number(c.textContent)));
    //                           S  T  R  I  D  E
    expect(counts("auth-api")).toEqual([1, 1, 0, 0, 0, 0]);
    expect(counts("billing")).toEqual([1, 0, 0, 1, 0, 0]);
    expect(counts("search")).toEqual([0, 0, 0, 0, 1, 0]);
  });

  it("lists threats from most to least severe", () => {
    seed([
      threat("a", { service: "low", severity: 1 }),
      threat("b", { service: "crit", severity: 5 }),
      threat("c", { service: "mid", severity: 3 }),
    ]);
    render(<ThreatModelClient />);
    expect(statusOrder()).toEqual(["crit", "mid", "low"]);
    // The stored order is left untouched by the display sort.
    expect(threats().map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a corrupt row visible and clamps its severity for the KPI", () => {
    seed([
      threat("a", {
        service: "legacy",
        category: "bogus" as Threat["category"],
        severity: 9,
      }),
      threat("b", { service: "zero", category: "tampering", severity: 0 }),
    ]);
    render(<ThreatModelClient />);
    expect(screen.getByText("S · Spoofing")).toBeInTheDocument();
    expect(screen.getByText("SEV 9")).toBeInTheDocument();
    expect(kpi("Critical (4-5)")).toBe("1"); // 9 → 5; 0 → 1
    const table = screen.getByRole("table");
    const legacy = within(table).getByRole("rowheader", { name: "legacy" }).closest("tr")!;
    expect(within(legacy).getAllByRole("cell")[0]).toHaveTextContent("1");
  });
});

describe("Threat model: adding a threat", () => {
  it("adds a trimmed open threat at the top and resets the form", () => {
    seed([threat("old", { service: "old-svc" })]);
    render(<ThreatModelClient />);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "  auth-api  " } });
    fireEvent.change(screen.getByLabelText("Mitigation (optional)"), {
      target: { value: "  Rotate signing keys  " },
    });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Forged JWT" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add threat/ }));

    const [added, old] = threats();
    expect(old.id).toBe("old");
    expect(added).toMatchObject({
      service: "auth-api",
      category: "spoofing",
      severity: 3,
      status: "open",
      mitigation: "Rotate signing keys",
      description: "Forged JWT",
      raisedAt: TODAY,
    });
    expect(history.log).toHaveBeenCalledWith(THREAT_MODEL_ACTIONS.THREAT_ADDED, {
      threatId: added.id,
      service: "auth-api",
      category: "spoofing",
      severity: 3,
      description: "Forged JWT",
    });
    expect(screen.getByLabelText("Service")).toHaveValue("");
    expect(screen.getByLabelText("Mitigation (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
  });

  it("adds on Enter in the service field, leaving blank text fields unset", () => {
    render(<ThreatModelClient />);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "billing" } });
    fireEvent.change(screen.getByLabelText("Mitigation (optional)"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByLabelText("Service"), { key: "Enter" });
    expect(threats()).toHaveLength(1);
    expect(threats()[0].mitigation).toBeUndefined();
    expect(threats()[0].description).toBeUndefined();
    expect(kpi("Open threats")).toBe("1");
  });

  it("ignores a blank service", () => {
    render(<ThreatModelClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add threat/ }));
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByLabelText("Service"), { key: "Enter" });
    expect(useWorkspaceStore.getState().threatModels).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("uses the chosen category and slider severity, then resets severity to 3", () => {
    render(<ThreatModelClient />);
    chooseOption(screen.getByRole("combobox", { name: "STRIDE category" }), "Tampering");
    const slider = screen.getByRole("slider", { name: "Severity" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuetext", "5 of 5");
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "payments" } });
    fireEvent.click(screen.getByRole("button", { name: /Add threat/ }));

    expect(threats()[0]).toMatchObject({ category: "tampering", severity: 5 });
    expect(screen.getByText("T · Tampering")).toBeInTheDocument();
    expect(kpi("Critical (4-5)")).toBe("1");
    expect(screen.getByRole("slider", { name: "Severity" })).toHaveAttribute(
      "aria-valuetext",
      "3 of 5"
    );
  });
});

describe("Threat model: editing a threat", () => {
  it("stamps mitigatedAt once and preserves it when the threat re-opens", () => {
    seed([threat("a", { service: "auth-api" })]);
    render(<ThreatModelClient />);
    const status = () => screen.getByRole("combobox", { name: "Status for auth-api" });

    chooseOption(status(), "Mitigated");
    expect(threats()[0]).toMatchObject({ status: "mitigated", mitigatedAt: TODAY });
    expect(history.log).toHaveBeenCalledWith(THREAT_MODEL_ACTIONS.THREAT_UPDATED, {
      threatId: "a",
      fields: ["status", "mitigatedAt"],
    });
    expect(kpi("Mitigation rate")).toBe("100%");

    vi.setSystemTime(new Date(2026, 9, 20, 12, 0));
    chooseOption(status(), "Open");
    expect(threats()[0]).toMatchObject({ status: "open", mitigatedAt: TODAY });
    chooseOption(status(), "Mitigated");
    expect(threats()[0].mitigatedAt).toBe(TODAY);
    expect(history.log).toHaveBeenLastCalledWith(THREAT_MODEL_ACTIONS.THREAT_UPDATED, {
      threatId: "a",
      fields: ["status"],
    });
  });

  it("commits a trimmed mitigation on blur and clears it when emptied", () => {
    seed([threat("a", { service: "auth-api" })]);
    render(<ThreatModelClient />);
    const box = screen.getByRole("textbox", { name: "Mitigation plan for auth-api" });
    fireEvent.change(box, { target: { value: "  Add MFA  " } });
    expect(threats()[0].mitigation).toBeUndefined(); // draft only
    fireEvent.blur(box);
    expect(threats()[0].mitigation).toBe("Add MFA");
    expect(history.log).toHaveBeenCalledWith(THREAT_MODEL_ACTIONS.THREAT_UPDATED, {
      threatId: "a",
      fields: ["mitigation"],
    });
    expect(box).toHaveValue("Add MFA");

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(threats()[0].mitigation).toBeUndefined();
    expect(box).toHaveValue("");
  });

  it("commits the description on blur", () => {
    seed([threat("a", { service: "auth-api", description: "old" })]);
    render(<ThreatModelClient />);
    const box = screen.getByRole("textbox", { name: "Description for auth-api" });
    expect(box).toHaveValue("old");
    fireEvent.change(box, { target: { value: "Token replay across tenants" } });
    fireEvent.blur(box);
    expect(threats()[0].description).toBe("Token replay across tenants");
  });

  it("re-syncs an idle field from outside edits but never clobbers one being typed in", () => {
    seed([threat("a", { service: "auth-api", mitigation: "v1", description: "d1" })]);
    render(<ThreatModelClient />);
    const mitigation = screen.getByRole("textbox", { name: "Mitigation plan for auth-api" });
    const description = screen.getByRole("textbox", { name: "Description for auth-api" });

    act(() => description.focus());
    fireEvent.change(description, { target: { value: "typing…" } });
    act(() => seed([threat("a", { service: "auth-api", mitigation: "v2", description: "d2" })]));
    expect(mitigation).toHaveValue("v2");
    expect(description).toHaveValue("typing…");
  });

  it("removes only the chosen threat and logs it", () => {
    seed([
      threat("a", { service: "auth-api", category: "tampering" }),
      threat("b", { service: "billing" }),
    ]);
    render(<ThreatModelClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove auth-api threat" }));
    expect(threats().map((t) => t.id)).toEqual(["b"]);
    expect(history.log).toHaveBeenCalledWith(THREAT_MODEL_ACTIONS.THREAT_REMOVED, {
      threatId: "a",
      service: "auth-api",
      category: "tampering",
    });
    expect(kpi("Services covered")).toBe("1");
  });
});

describe("Threat model: export", () => {
  it("exports every threat with blanks for unset fields", () => {
    seed([
      threat("a", {
        service: "auth-api",
        severity: 4,
        status: "mitigated",
        mitigation: "MFA",
        description: "Phishing",
        mitigatedAt: "2026-10-05",
      }),
      threat("b", { service: "billing", category: "repudiation" }),
    ]);
    render(<ThreatModelClient />);
    expect(exported.csv?.headers).toEqual([
      "Service",
      "Category",
      "Severity",
      "Status",
      "Mitigation",
      "Description",
      "Raised",
      "Mitigated",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["auth-api", "spoofing", 4, "mitigated", "MFA", "Phishing", "2026-10-01", "2026-10-05"],
      ["billing", "repudiation", 3, "open", "", "", "2026-10-01", ""],
    ]);
  });
});
