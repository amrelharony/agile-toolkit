import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ComplianceControl } from "@/lib/stores/workspace-types";
import { sanitizeEvidenceUrl } from "@/app/(tools)/control-map/evidence-url";

/**
 * Compliance Control Map: the evidence-URL sanitiser, adding a control,
 * the KPIs and per-framework dashboard, the list order, editing a control
 * (status, owner, description), evidence links and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
const toasts = vi.hoisted(() => ({ error: [] as string[] }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: {
    error: (msg: string) => toasts.error.push(msg),
    success: () => {},
  },
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { ControlMapClient } from "@/app/(tools)/control-map/control-map-client";

const CM_ID = "controlMap:current";

const controls = () =>
  (useWorkspaceStore.getState().controlMaps ?? []).find((d) => d.id === CM_ID)?.controls ?? [];
const seed = (list: ComplianceControl[]) =>
  useWorkspaceStore.setState({ controlMaps: [{ id: CM_ID, controls: list }] });
const control = (
  id: string,
  controlId: string,
  extra: Partial<ComplianceControl> = {}
): ComplianceControl => ({
  id,
  controlId,
  framework: "soc2",
  title: `Control ${controlId}`,
  status: "not_started",
  evidenceLinks: [],
  ...extra,
});

const kpi = (label: string) =>
  screen.getByText(label).parentElement!.parentElement!.textContent ?? "";

function choose(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  logs.length = 0;
  toasts.error.length = 0;
  exported.csv = undefined;
  useWorkspaceStore.setState({ controlMaps: [] });
});

describe("sanitizeEvidenceUrl", () => {
  it("keeps http(s) URLs, normalised", () => {
    expect(sanitizeEvidenceUrl("https://wiki.example.com/runbook")).toBe(
      "https://wiki.example.com/runbook"
    );
    expect(sanitizeEvidenceUrl("http://intranet.local")).toBe("http://intranet.local/");
    expect(sanitizeEvidenceUrl("  HTTPS://Example.com/A b  ")).toBe("https://example.com/A%20b");
  });

  it("adds https to a scheme-less or scheme-relative link", () => {
    expect(sanitizeEvidenceUrl("wiki.example.com/soc2")).toBe("https://wiki.example.com/soc2");
    expect(sanitizeEvidenceUrl("//cdn.example.com/a.pdf")).toBe("https://cdn.example.com/a.pdf");
  });

  it("rejects blanks, other schemes and malformed URLs", () => {
    for (const bad of [
      "",
      "   ",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "mailto:sec@example.com",
      "https://",
      "http://exa mple.com",
    ]) {
      expect(sanitizeEvidenceUrl(bad)).toBeNull();
    }
  });
});

describe("Control map: empty", () => {
  it("shows the empty state, zero KPIs and no dashboard", () => {
    render(<ControlMapClient />);
    expect(screen.getByText(/No controls yet/)).toBeInTheDocument();
    expect(kpi("Total controls")).toBe("Total controls0");
    expect(kpi("% verified")).toBe("% verified0%");
    expect(kpi("Open gaps")).toBe("Open gaps0");
    expect(kpi("Evidence items")).toBe("Evidence items0");
    expect(screen.queryByText("Compliance dashboard")).toBeNull();
  });
});

describe("Control map: adding a control", () => {
  it("needs a control id and a title", () => {
    render(<ControlMapClient />);
    const add = screen.getByRole("button", { name: "Add control" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Control ID"), { target: { value: "CC6.1" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Access" } });
    expect(add).toBeEnabled();
  });

  it("adds a trimmed control with the chosen framework and status, then resets", () => {
    seed([control("old", "CC1.1")]);
    render(<ControlMapClient />);
    fireEvent.change(screen.getByLabelText("Control ID"), { target: { value: " A.9.4.2 " } });
    choose(screen.getByRole("combobox", { name: "Framework" }), "ISO 27001");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " Secure log-on " } });
    fireEvent.change(screen.getByLabelText("Owner (optional)"), { target: { value: " IT " } });
    choose(screen.getByRole("combobox", { name: "Initial status" }), "Implemented");
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: " MFA everywhere " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add control" }));

    expect(controls()[0]).toMatchObject({
      controlId: "A.9.4.2",
      framework: "iso27001",
      title: "Secure log-on",
      owner: "IT",
      status: "implemented",
      evidenceLinks: [],
      description: "MFA everywhere",
    });
    expect(controls()[1].id).toBe("old");
    expect(logs[0]).toMatchObject({
      action: "control_added",
      payload: { controlId: "A.9.4.2", framework: "iso27001" },
    });
    expect(screen.getByLabelText("Control ID")).toHaveValue("");
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Owner (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Initial status" })).toHaveTextContent(
      "Not Started"
    );
    expect(screen.getByText("Implemented & ready for audit review.")).toBeInTheDocument();
  });

  it("stores no owner or description when blank", () => {
    render(<ControlMapClient />);
    fireEvent.change(screen.getByLabelText("Control ID"), { target: { value: "CC1.1" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ethics" } });
    fireEvent.change(screen.getByLabelText("Owner (optional)"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add control" }));
    expect(controls()[0]).toMatchObject({ framework: "soc2", status: "not_started" });
    expect(controls()[0].owner).toBeUndefined();
    expect(controls()[0].description).toBeUndefined();
  });
});

describe("Control map: KPIs, dashboard and order", () => {
  beforeEach(() =>
    seed([
      control("c1", "Art.32", {
        framework: "gdpr",
        status: "verified",
        evidenceLinks: ["https://a"],
      }),
      control("c2", "CC6.1", { status: "implemented", evidenceLinks: ["https://b", "https://c"] }),
      control("c3", "CC7.2", { status: "in_progress" }),
      control("c4", "A.10.1.1", { framework: "iso27001", status: "verified" }),
      control("c5", "A.9.4.2", { framework: "iso27001" }),
      control("c6", "X-1", { framework: "custom", status: "verified" }),
    ])
  );

  it("counts totals, % verified, open gaps and evidence", () => {
    render(<ControlMapClient />);
    expect(kpi("Total controls")).toBe("Total controls6");
    expect(kpi("% verified")).toBe("% verified50%");
    expect(kpi("Open gaps")).toBe("Open gaps2");
    expect(kpi("Evidence items")).toBe("Evidence items3");
  });

  it("shows each framework in the canonical order with implemented-or-verified progress", () => {
    render(<ControlMapClient />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual([
      "SOC 2 controls implemented",
      "ISO 27001 controls implemented",
      "GDPR controls implemented",
      "Custom controls implemented",
    ]);
    const row = (label: string) =>
      screen.getByRole("progressbar", { name: `${label} controls implemented` })
        .previousElementSibling!.textContent;
    expect(row("SOC 2")).toBe("SOC 21 / 2 (50%)");
    expect(row("ISO 27001")).toBe("ISO 270011 / 2 (50%)");
    expect(row("GDPR")).toBe("GDPR1 / 1 (100%)");
    expect(row("Custom")).toBe("Custom1 / 1 (100%)");
  });

  // Bug: controls sorted as plain strings, so A.10.1.1 came before A.9.4.2.
  it("lists controls grouped by framework, in natural control-id order", () => {
    render(<ControlMapClient />);
    const order = screen
      .getAllByRole("button", { name: /^Remove (?!evidence)/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual([
      "Remove X-1",
      "Remove Art.32",
      "Remove A.9.4.2",
      "Remove A.10.1.1",
      "Remove CC6.1",
      "Remove CC7.2",
    ]);
    // Rendering sorts a copy; the stored order is untouched.
    expect(controls().map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
  });

  it("exports each control with its evidence joined", () => {
    render(<ControlMapClient />);
    expect(exported.csv?.rows[1]).toEqual([
      "CC6.1",
      "SOC 2",
      "Control CC6.1",
      "implemented",
      "",
      2,
      "https://b | https://c",
      "",
    ]);
  });
});

describe("Control map: editing a control", () => {
  beforeEach(() => seed([control("c1", "CC6.1"), control("c2", "CC7.2")]));

  it("changes the status and shows the matching note", () => {
    render(<ControlMapClient />);
    choose(screen.getByRole("combobox", { name: "Status for CC6.1" }), "Verified");
    expect(controls()[0].status).toBe("verified");
    expect(controls()[1].status).toBe("not_started");
    expect(screen.getByText("Verified: audited, evidence checked.")).toBeInTheDocument();
    expect(logs.at(-1)).toMatchObject({
      action: "control_updated",
      payload: { controlDbId: "c1", fields: ["status"] },
    });
    expect(kpi("% verified")).toBe("% verified50%");
  });

  it("saves owner and description trimmed on blur, and clears them when blank", () => {
    render(<ControlMapClient />);
    const owner = screen.getByLabelText("Owner for CC6.1");
    fireEvent.change(owner, { target: { value: "  Sec team " } });
    expect(controls()[0].owner).toBeUndefined();
    fireEvent.blur(owner);
    expect(controls()[0].owner).toBe("Sec team");
    expect(owner).toHaveValue("Sec team");

    const desc = screen.getByLabelText("Description for CC6.1");
    fireEvent.change(desc, { target: { value: " Quarterly access review " } });
    fireEvent.blur(desc);
    expect(controls()[0].description).toBe("Quarterly access review");

    fireEvent.change(owner, { target: { value: "" } });
    fireEvent.blur(owner);
    expect(controls()[0].owner).toBeUndefined();
    expect(logs.filter((l) => l.action === "control_updated")).toHaveLength(3);
  });

  it("does not log or write when a field is left unchanged", () => {
    render(<ControlMapClient />);
    const owner = screen.getByLabelText("Owner for CC6.1");
    fireEvent.focus(owner);
    fireEvent.blur(owner);
    expect(logs).toEqual([]);
  });

  it("removes only the chosen control", () => {
    render(<ControlMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove CC6.1" }));
    expect(controls().map((c) => c.id)).toEqual(["c2"]);
    expect(logs.at(-1)).toMatchObject({
      action: "control_removed",
      payload: { controlDbId: "c1", controlId: "CC6.1", framework: "soc2" },
    });
  });
});

describe("Control map: evidence links", () => {
  beforeEach(() => seed([control("c1", "CC6.1")]));

  it("adds a link, defaulting to https, on the button or Enter", () => {
    render(<ControlMapClient />);
    const input = screen.getByLabelText("New evidence link for CC6.1");
    const add = screen.getByRole("button", { name: "Add evidence link to CC6.1" });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "wiki.example.com/access-review" } });
    fireEvent.click(add);
    fireEvent.change(input, { target: { value: "https://drive.example.com/q3.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(controls()[0].evidenceLinks).toEqual([
      "https://wiki.example.com/access-review",
      "https://drive.example.com/q3.pdf",
    ]);
    expect(input).toHaveValue("");
    expect(screen.getByText("Evidence (2)", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://wiki.example.com/access-review" })
    ).toHaveAttribute("href", "https://wiki.example.com/access-review");
    expect(kpi("Evidence items")).toBe("Evidence items2");
    expect(logs.filter((l) => l.action === "evidence_added")).toHaveLength(2);
  });

  it("refuses a non-http link with a toast and keeps the typed text", () => {
    render(<ControlMapClient />);
    const input = screen.getByLabelText("New evidence link for CC6.1");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(controls()[0].evidenceLinks).toEqual([]);
    expect(toasts.error).toEqual(["Evidence URL must be http(s) and well-formed"]);
    expect(input).toHaveValue("javascript:alert(1)");
  });

  it("removes the chosen link only", () => {
    seed([control("c1", "CC6.1", { evidenceLinks: ["https://a.example", "https://b.example"] })]);
    render(<ControlMapClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove evidence link" })[0]);
    expect(controls()[0].evidenceLinks).toEqual(["https://b.example"]);
    expect(screen.queryByRole("link", { name: "https://a.example" })).toBeNull();
    expect(screen.getByRole("link", { name: "https://b.example" })).toBeInTheDocument();
  });

  // Bug: a stored link that never went through the page's sanitiser (an agent
  // write, an import) was rendered as a live javascript: href.
  it("never renders a stored non-http link as a clickable href", () => {
    seed([control("c1", "CC6.1", { evidenceLinks: ["javascript:alert(document.cookie)"] })]);
    render(<ControlMapClient />);
    const text = screen.getByText("javascript:alert(document.cookie)");
    expect(text.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});
