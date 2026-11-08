import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataEntryTable } from "@/app/(tools)/cumulative-flow/components/data-entry-table";
import { ColumnsCard } from "@/app/(tools)/cumulative-flow/components/columns-card";
import { DEFAULT_COLUMNS } from "@/app/(tools)/cumulative-flow/constants";

/**
 * Cumulative Flow's typed snapshot fields on a touch screen (mobile audit
 * 2026-11-08): the saved snapshots' date, counts and note were 32 px tall and
 * the column names 28 px. `pointer-coarse:min-h-11` makes them 44 px on any
 * touch screen (a phone's cards, a tablet's table) and wins over the height;
 * a desktop keeps the compact table (h-8 below md, the Input's md:h-9 above).
 */

const noop = () => {};

describe("Cumulative Flow's typed snapshot fields", () => {
  it("are 44 px tall on touch and keep the desktop height", () => {
    render(
      <TooltipProvider>
        <DataEntryTable
          entries={[{ id: "e1", date: "2026-11-06", counts: { "col-1": 3, "col-2": 2 } }]}
          columns={DEFAULT_COLUMNS}
          today="2026-11-08"
          onUpdateDate={() => true}
          onUpdateNote={noop}
          onUpdateCount={noop}
          onRemoveEntry={noop}
        />
      </TooltipProvider>
    );
    const fields = [
      ...screen.getAllByLabelText("Date of the snapshot from 2026-11-06"),
      ...screen.getAllByLabelText("To Do on 2026-11-06"),
      ...screen.getAllByLabelText("Note for 2026-11-06"),
    ];
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const field of fields) {
      expect(field).toHaveClass("pointer-coarse:min-h-11", "h-8", "md:h-9");
    }
  });

  it("keep neighbouring counts 8 px or more apart on a phone's card", () => {
    render(
      <TooltipProvider>
        <DataEntryTable
          entries={[{ id: "e1", date: "2026-11-06", counts: { "col-1": 3 } }]}
          columns={DEFAULT_COLUMNS}
          today="2026-11-08"
          onUpdateDate={() => true}
          onUpdateNote={noop}
          onUpdateCount={noop}
          onRemoveEntry={noop}
        />
      </TooltipProvider>
    );
    // The card's rows sit 6 px apart; each count adds 2 px above and below.
    for (const count of screen.getAllByLabelText("In Progress on 2026-11-06")) {
      expect(count.parentElement).toHaveClass("max-md:py-0.5");
    }
  });

  it("include column names 44 px tall on touch", () => {
    render(
      <TooltipProvider>
        <ColumnsCard
          columns={DEFAULT_COLUMNS}
          onAdd={noop}
          onRename={noop}
          onDescribe={noop}
          onRemove={noop}
        />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Name of column 1")).toHaveClass("pointer-coarse:min-h-11", "h-7");
  });
});
