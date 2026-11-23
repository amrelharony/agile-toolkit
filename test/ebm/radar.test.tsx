/**
 * The EBM radar's labels: the left and right ones grow outwards from
 * their spokes and never meet, every line stays inside the drawing, and
 * "not measured" sits on its own line. Widths are measured as the page's
 * mono font sets them (0.6 em a character).
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EBM_VALUE_AREAS } from "@/lib/stores/workspace-types";
import { EbmRadar, RADAR_BOX, RADAR_FONT, radarLabel } from "@/app/(tools)/ebm-dashboard/radar";

const CHAR = RADAR_FONT * 0.6;

/** A label's horizontal extent, from its anchor and its longest line. */
function extent(i: number, measured: boolean) {
  const l = radarLabel(i, EBM_VALUE_AREAS[i], measured);
  const w = Math.max(...l.lines.map((s) => s.length)) * CHAR;
  const from = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
  return { from, to: from + w, label: l };
}

describe("the radar's labels", () => {
  it.each([true, false])("keep the sides apart and inside the box (measured: %s)", (measured) => {
    const right = extent(1, measured);
    const left = extent(3, measured);
    expect(right.label.anchor).toBe("start");
    expect(right.from).toBeGreaterThan(RADAR_BOX.cx + RADAR_BOX.radius);
    expect(left.label.anchor).toBe("end");
    expect(left.to).toBeLessThan(RADAR_BOX.cx - RADAR_BOX.radius);
    expect(left.to).toBeLessThan(right.from);
    for (let i = 0; i < 4; i++) {
      const e = extent(i, measured);
      expect(e.from, EBM_VALUE_AREAS[i]).toBeGreaterThanOrEqual(0);
      expect(e.to, EBM_VALUE_AREAS[i]).toBeLessThanOrEqual(RADAR_BOX.width);
      const last = e.label.y + (e.label.lines.length - 1) * 13;
      expect(e.label.y - RADAR_FONT).toBeGreaterThanOrEqual(0);
      expect(last + 4).toBeLessThanOrEqual(RADAR_BOX.height);
    }
  });

  it("puts not measured on its own line beside a side spoke", () => {
    expect(radarLabel(1, "unrealized-value", false).lines).toEqual([
      "Unrealized",
      "Value",
      "not measured",
    ]);
    expect(radarLabel(3, "ability-to-innovate", true).lines).toEqual(["Ability to", "Innovate"]);
    expect(radarLabel(0, "current-value", false).lines).toEqual(["Current Value: not measured"]);
  });

  it("draws each label's lines as their own tspans", () => {
    const { container } = render(
      <TooltipProvider>
        <EbmRadar scores={{ "current-value": 0.5 }} />
      </TooltipProvider>
    );
    const side = container.querySelector('text[data-area="unrealized-value"]');
    expect(Array.from(side?.querySelectorAll("tspan") ?? []).map((t) => t.textContent)).toEqual([
      "Unrealized",
      "Value",
      "not measured",
    ]);
    expect(side?.getAttribute("text-anchor")).toBe("start");
    expect(container.querySelector('text[data-area="current-value"]')?.textContent).toBe(
      "Current Value"
    );
  });
});
