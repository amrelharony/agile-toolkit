import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  COMMITTED_OPACITY,
  GRADE_FILL,
  NARROW_PLOT_PX,
  VelocityChart,
  shortSprintName,
  sprintAxisTicks,
  velocityLegendPayload,
  type VelocityChartRow,
} from "@/app/(tools)/velocity/charts";

/**
 * The velocity chart at phone width (mobile audit 2026-11-08): the legend
 * showed two identical swatches that matched neither series and listed a
 * Trend that wasn't drawn; the 30% Committed bars were about 1.9:1 on the
 * night card; and Recharts dropped Sprint 2 and Sprint 4 from the axis. The
 * chart renders for real (a fixed size, so nothing has to be measured).
 */

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const sprintTicks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-cartesian-axis-tick-value"))
    .map((t) => t.textContent ?? "")
    .filter((t) => !/^\d+$/.test(t));

const VELOCITY: VelocityChartRow[] = [
  { name: "Sprint 1", committed: 34, completed: 29, grade: "close", sayDoPct: 85 },
  { name: "Sprint 2", committed: 32, completed: 31, grade: "met", sayDoPct: 97 },
  {
    name: "Sprint 3",
    committed: 36,
    completed: 30,
    grade: "close",
    sayDoPct: 83,
    rollingAvg: 30,
  },
  {
    name: "Sprint 4",
    committed: 33,
    completed: 33,
    grade: "met",
    sayDoPct: 100,
    rollingAvg: 31.3,
  },
  { name: "Sprint 5", committed: 35, completed: null },
];

describe("velocityLegendPayload", () => {
  it("names Committed as its tint and Completed by the grades the bars wear", () => {
    const legend = velocityLegendPayload(VELOCITY);
    expect(legend.map((e) => e.value)).toEqual([
      "Committed",
      "Completed (met)",
      "Completed (close)",
      "Velocity (last 3)",
    ]);
    expect(legend[0].legendIcon).toBeDefined();
    expect(legend[1]).toMatchObject({ type: "rect", color: GRADE_FILL.met });
    expect(legend[2]).toMatchObject({ type: "rect", color: GRADE_FILL.close });
  });

  it("lists Trend only once a row has a trend value", () => {
    expect(velocityLegendPayload(VELOCITY).map((e) => e.value)).not.toContain("Trend");
    const withTrend = VELOCITY.map((r, i) => ({ ...r, trend: 30 + i }));
    expect(velocityLegendPayload(withTrend).map((e) => e.value)).toContain("Trend");
  });

  it("keeps a plain Completed swatch for a finished sprint without a grade", () => {
    const legend = velocityLegendPayload([{ name: "Sprint 1", committed: 0, completed: 4 }]);
    expect(legend.map((e) => e.value)).toEqual(["Committed", "Completed"]);
  });
});

describe("VelocityChart", () => {
  it("renders the legend from the payload, the Committed swatch as its tint", () => {
    const { container } = render(<VelocityChart data={VELOCITY} width={292} height={350} />);
    expect(screen.getByText("Completed (met)")).toBeInTheDocument();
    expect(screen.queryByText("Trend")).not.toBeInTheDocument();
    const swatch = container.querySelector('[aria-label="Committed legend icon"] path');
    expect(swatch).toHaveAttribute("fill-opacity", String(COMMITTED_OPACITY));
  });
});

describe("the sprint axis", () => {
  it("shortens only 'Sprint N' names", () => {
    expect(shortSprintName("Sprint 12")).toBe("S12");
    expect(shortSprintName("sprint 3")).toBe("S3");
    expect(shortSprintName("Payments push")).toBe("Payments push");
  });

  it("keeps full names where they fit and labels every bar where they don't", () => {
    const names = VELOCITY.map((r) => r.name);
    expect(sprintAxisTicks(names, 900)).toEqual({});
    const phone = sprintAxisTicks(names, 212);
    expect(phone.interval).toBe(0);
    expect(phone.format?.("Sprint 2")).toBe("S2");
    // Too many even shortened: shortened, and Recharts thins them.
    const many = Array.from({ length: 40 }, (_, i) => `Sprint ${i + 1}`);
    expect(sprintAxisTicks(many, 212).interval).toBeUndefined();
  });

  it("leaves a desktop-wide plot to Recharts, however many sprints", () => {
    // 14 sprints in a 1280 px desktop's plot: about 62 px a bar, where
    // Recharts fits "Sprint 14" (the estimate alone would have shortened them).
    const fourteen = Array.from({ length: 14 }, (_, i) => `Sprint ${i + 1}`);
    expect(sprintAxisTicks(fourteen, 870)).toEqual({});
    expect(sprintAxisTicks(fourteen, NARROW_PLOT_PX)).toEqual({});
    // Just under the line, a crowded axis is still shortened.
    expect(sprintAxisTicks(fourteen, NARROW_PLOT_PX - 1).format?.("Sprint 14")).toBe("S14");
  });

  it("draws S1–S5 on a phone and the full names on a wide chart", () => {
    const { container, unmount } = render(
      <VelocityChart data={VELOCITY} width={292} height={350} />
    );
    expect(sprintTicks(container)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    unmount();
    const wide = render(<VelocityChart data={VELOCITY} width={1000} height={350} />);
    expect(sprintTicks(wide.container)).toContain("Sprint 1");
  });
});

/* -------------------------------------------------------------------------- */
/*  Committed contrast (the three themes parsed from globals.css)              */
/* -------------------------------------------------------------------------- */

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no ${selector} block in globals.css`);
  return Object.fromEntries(
    Array.from(match[1].matchAll(/--([\w-]+):\s*([^;]+);/g), (m) => [m[1], m[2].trim()])
  );
}

type Rgb = [number, number, number];

function hex(theme: Record<string, string>, token: string): Rgb {
  const m = theme[token]?.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`--${token}: expected a 6-digit hex colour, got ${theme[token]}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const over = (colour: Rgb, surface: Rgb, amount: number): Rgb =>
  colour.map((c, i) => c * amount + surface[i] * (1 - amount)) as Rgb;

const night = block(":root");
const THEMES: [string, Record<string, string>][] = [
  ["comic", { ...night, ...block('[data-theme="light"]') }],
  ["night", night],
  ["high contrast", { ...night, ...block('[data-theme="hc"]') }],
];

describe("the Committed bar's contrast (WCAG 1.4.11, 3:1)", () => {
  it("fills at 3:1 or more against the night card", () => {
    const fill = over(hex(night, "chart-1"), hex(night, "card"), COMMITTED_OPACITY);
    expect(contrast(fill, hex(night, "card"))).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)("is outlined at 3:1 or more on the %s card", (_name, theme) => {
    expect(contrast(hex(theme, "chart-1"), hex(theme, "card"))).toBeGreaterThanOrEqual(3);
  });
});
