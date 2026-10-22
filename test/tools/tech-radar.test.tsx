import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Tech Radar core: adding / moving / removing blips, the KPI tiles (ring
 * split, recently moved, on hold), the ring lists, where each blip is drawn
 * (inside its ring band and its quadrant's sector) and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { TechRadarClient } from "@/app/(tools)/tech-radar/tech-radar-client";

const KEY = "agile-toolkit:tech-radar";
const NOW = new Date(2026, 9, 19, 12, 0);
const DAY = 86_400_000;

type Ring = "adopt" | "trial" | "assess" | "hold";
type Quadrant = "languages_frameworks" | "tools" | "platforms" | "techniques";
interface Blip {
  id: string;
  name: string;
  ring: Ring;
  quadrant: Quadrant;
  movedAt: string;
  description?: string;
}

const blip = (
  id: string,
  name: string,
  ring: Ring,
  quadrant: Quadrant,
  extra: Partial<Blip> = {}
): Blip => ({
  id,
  name,
  ring,
  quadrant,
  movedAt: new Date(NOW.getTime() - 60 * DAY).toISOString(),
  ...extra,
});

const seed = (blips: Blip[]) => localStorage.setItem(KEY, JSON.stringify(blips));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Blip[];

/** The value (and hint) of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  const value = tile.parentElement!.nextElementSibling as HTMLElement;
  return { value: value.textContent, hint: value.nextElementSibling?.textContent };
};

function choose(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

/** The ring-list card headed e.g. "Trial (2)". */
const ringCard = (label: string) =>
  screen.getByText(new RegExp(`^${label} \\(\\d+\\)$`)).parentElement as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  localStorage.removeItem(KEY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Tech Radar — empty state", () => {
  it("shows the empty message, zeroed KPIs and a disabled Add button", () => {
    render(<TechRadarClient />);
    expect(screen.getByRole("status")).toHaveTextContent(/No blips yet\./);
    expect(kpi("Total blips").value).toBe("0");
    expect(kpi("By ring")).toEqual({ value: "0/0/0/0", hint: "adopt/trial/assess/hold" });
    expect(kpi("Recently moved").value).toBe("0");
    expect(kpi("On hold").value).toBe("0");
    expect(screen.getByRole("button", { name: /Add blip/ })).toBeDisabled();
    expect(screen.queryByRole("img", { name: "Technology radar chart" })).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });

  it("keeps Add disabled for a whitespace-only name", () => {
    render(<TechRadarClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Blip name" }), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: /Add blip/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Blip name" }), {
      target: { value: "Bun" },
    });
    expect(screen.getByRole("button", { name: /Add blip/ })).toBeEnabled();
  });
});

describe("Tech Radar — adding", () => {
  it("adds a trimmed blip in Assess / Tools by default, stamped now, and clears the text", () => {
    seed([blip("old", "Postgres", "adopt", "platforms")]);
    render(<TechRadarClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Blip name" }), {
      target: { value: "  Bun  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "  Faster installs  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add blip/ }));

    expect(stored().map((b) => b.name)).toEqual(["Postgres", "Bun"]);
    expect(stored()[1]).toMatchObject({
      ring: "assess",
      quadrant: "tools",
      movedAt: NOW.toISOString(),
      description: "Faster installs",
    });
    expect(screen.getByRole("textbox", { name: "Blip name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(kpi("Total blips").value).toBe("2");
    expect(kpi("Recently moved").value).toBe("1");
    expect(ringCard("Assess")).toHaveTextContent("Bun");
  });

  it("uses the ring and quadrant picked in the dropdowns and stores a blank description as undefined", () => {
    render(<TechRadarClient />);
    choose(screen.getByRole("combobox", { name: "Ring" }), "Hold");
    choose(screen.getByRole("combobox", { name: "Quadrant" }), "Languages & Frameworks");
    fireEvent.change(screen.getByRole("textbox", { name: "Blip name" }), {
      target: { value: "CoffeeScript" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add blip/ }));

    expect(stored()[0]).toMatchObject({
      name: "CoffeeScript",
      ring: "hold",
      quadrant: "languages_frameworks",
    });
    expect(stored()[0].description).toBeUndefined();
    expect(kpi("On hold").value).toBe("1");
    expect(ringCard("Hold")).toHaveTextContent("Languages & Frameworks");
  });
});

describe("Tech Radar — moving and removing", () => {
  it("moves a blip to another ring and restamps movedAt", () => {
    seed([blip("a", "Vitest", "trial", "tools"), blip("b", "Jest", "adopt", "tools")]);
    render(<TechRadarClient />);
    choose(screen.getByRole("combobox", { name: "Move Vitest to ring" }), "Adopt");

    expect(stored().find((b) => b.id === "a")).toMatchObject({
      ring: "adopt",
      movedAt: NOW.toISOString(),
    });
    expect(stored().find((b) => b.id === "b")?.movedAt).not.toBe(NOW.toISOString());
    expect(kpi("By ring").value).toBe("2/0/0/0");
    expect(kpi("Recently moved").value).toBe("1");
    expect(within(ringCard("Trial")).getByText("No blips in this ring.")).toBeInTheDocument();
  });

  it("leaves movedAt alone when the same ring is picked", () => {
    const original = blip("a", "Vitest", "trial", "tools");
    seed([original]);
    render(<TechRadarClient />);
    choose(screen.getByRole("combobox", { name: "Move Vitest to ring" }), "Trial");
    expect(stored()[0].movedAt).toBe(original.movedAt);
  });

  it("removes the right blip and renumbers the rest", () => {
    seed([
      blip("a", "Vitest", "trial", "tools"),
      blip("b", "Jest", "hold", "tools"),
      blip("c", "Bun", "assess", "tools"),
    ]);
    const { container } = render(<TechRadarClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Jest" }));
    expect(stored().map((b) => b.id)).toEqual(["a", "c"]);
    expect(container.querySelector('g[data-blip-id="b"]')).toBeNull();
    expect(container.querySelector('g[data-blip-id="c"] text')?.textContent).toBe("2");
    expect(kpi("On hold").value).toBe("0");
  });

  it("goes back to the empty state when the last blip is removed", () => {
    seed([blip("a", "Vitest", "trial", "tools")]);
    render(<TechRadarClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Vitest" }));
    expect(stored()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(/No blips yet\./);
  });
});

describe("Tech Radar — KPIs and lists", () => {
  it("splits blips by ring and counts moves in the last 30 days only", () => {
    const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
    seed([
      blip("a", "A", "adopt", "tools", { movedAt: ago(1) }),
      blip("b", "B", "adopt", "tools", { movedAt: ago(30) }),
      blip("c", "C", "trial", "tools", { movedAt: ago(31) }),
      blip("d", "D", "hold", "tools", { movedAt: new Date(NOW.getTime() + DAY).toISOString() }),
      blip("e", "E", "hold", "tools", { movedAt: "not a date" }),
    ]);
    render(<TechRadarClient />);
    expect(kpi("Total blips").value).toBe("5");
    expect(kpi("By ring").value).toBe("2/1/0/2");
    expect(kpi("Recently moved").value).toBe("2");
    expect(kpi("On hold").value).toBe("2");
    expect(screen.getByText("Adopt (2)")).toBeInTheDocument();
    expect(screen.getByText("Assess (0)")).toBeInTheDocument();
  });

  it("shows each blip's quadrant and description in its ring list", () => {
    seed([blip("a", "Pairing", "adopt", "techniques", { description: "Default for risky work" })]);
    render(<TechRadarClient />);
    const card = ringCard("Adopt");
    expect(card).toHaveTextContent("Pairing");
    expect(card).toHaveTextContent("Techniques");
    expect(card).toHaveTextContent("Default for risky work");
  });
});

describe("Tech Radar — blip placement", () => {
  // Radar is 300 wide, centre 150, radius 144; each ring is a quarter of
  // the radius with 8px padding inside its band.
  const RING_BAND: Record<Ring, [number, number]> = {
    adopt: [8, 28],
    trial: [44, 64],
    assess: [80, 100],
    hold: [116, 136],
  };
  const CORNER: Record<Quadrant, [number, number]> = {
    languages_frameworks: [1, -1], // top-right
    tools: [1, 1], // bottom-right
    platforms: [-1, 1], // bottom-left
    techniques: [-1, -1], // top-left
  };

  it("draws every blip inside its ring band and its quadrant's corner", () => {
    const rings: Ring[] = ["adopt", "trial", "assess", "hold"];
    const quadrants: Quadrant[] = ["languages_frameworks", "tools", "platforms", "techniques"];
    const blips = rings.flatMap((r) =>
      quadrants.flatMap((q) => [0, 1, 2].map((k) => blip(`${r}-${q}-${k}`, `${r} ${q} ${k}`, r, q)))
    );
    seed(blips);
    const { container } = render(<TechRadarClient />);
    for (const b of blips) {
      const c = container.querySelector(`g[data-blip-id="${b.id}"] circle`)!;
      const dx = Number(c.getAttribute("cx")) - 150;
      const dy = Number(c.getAttribute("cy")) - 150;
      const r = Math.hypot(dx, dy);
      const [lo, hi] = RING_BAND[b.ring];
      expect(r, b.id).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(r, b.id).toBeLessThanOrEqual(hi + 1e-9);
      const [sx, sy] = CORNER[b.quadrant];
      expect(Math.sign(dx), b.id).toBe(sx);
      expect(Math.sign(dy), b.id).toBe(sy);
    }
  });

  it("places a blip at the same spot on every render", () => {
    seed([blip("stable", "Vitest", "trial", "tools")]);
    const first = render(<TechRadarClient />);
    const pos = (root: HTMLElement) => {
      const c = root.querySelector('g[data-blip-id="stable"] circle')!;
      return [c.getAttribute("cx"), c.getAttribute("cy")];
    };
    const a = pos(first.container);
    first.unmount();
    const second = render(<TechRadarClient />);
    expect(pos(second.container)).toEqual(a);
  });
});

describe("Tech Radar — export", () => {
  it("exports one CSV row per blip with the quadrant label", () => {
    seed([
      blip("a", "Vitest", "trial", "tools", { movedAt: "2026-10-01T00:00:00.000Z" }),
      blip("b", "Pairing", "adopt", "techniques", {
        movedAt: "2026-09-01T00:00:00.000Z",
        description: "Default",
      }),
    ]);
    render(<TechRadarClient />);
    expect(exported.csv?.headers).toEqual(["Name", "Ring", "Quadrant", "Moved At", "Description"]);
    expect(exported.csv?.rows).toEqual([
      ["Vitest", "trial", "Tools", "2026-10-01T00:00:00.000Z", ""],
      ["Pairing", "adopt", "Techniques", "2026-09-01T00:00:00.000Z", "Default"],
    ]);
  });
});
