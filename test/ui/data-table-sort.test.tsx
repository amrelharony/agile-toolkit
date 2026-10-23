import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable, sortRows, type DataTableColumn } from "@/components/shared/data-table";

/** Sortable columns: header buttons on desktop, a select on mobile, blanks last. */

type Row = { id: string; name: string; score: number | null };
const rows: Row[] = [
  { id: "1", name: "Beta", score: 5 },
  { id: "2", name: "alpha", score: null },
  { id: "3", name: "Gamma", score: 12 },
];
const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", primary: true, cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "score", header: "Score", cell: (r) => r.score ?? "—", sortValue: (r) => r.score },
];

const bodyNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelector("td")?.textContent);

describe("sortRows", () => {
  it("sorts numbers and text, keeping blanks last in both directions", () => {
    expect(sortRows(rows, (r) => r.score, "desc").map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(sortRows(rows, (r) => r.score, "asc").map((r) => r.id)).toEqual(["1", "3", "2"]);
    expect(sortRows(rows, (r) => r.name, "asc").map((r) => r.name)).toEqual([
      "alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("sorts numeric text naturally and is stable on ties", () => {
    const xs = [{ v: "item 10" }, { v: "item 2" }, { v: "item 2" }];
    expect(sortRows(xs, (x) => x.v, "asc")).toEqual([xs[1], xs[2], xs[0]]);
  });
});

describe("DataTable sorting", () => {
  it("keeps the given order until a header is clicked, then toggles direction", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole("table");
    expect(bodyNames(table)).toEqual(["Beta", "alpha", "Gamma"]);

    const scoreHeader = screen.getByRole("button", { name: /Score/ });
    fireEvent.click(scoreHeader);
    expect(bodyNames(table)).toEqual(["Gamma", "Beta", "alpha"]);
    expect(scoreHeader.closest("th")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(scoreHeader);
    expect(bodyNames(table)).toEqual(["Beta", "Gamma", "alpha"]);
    expect(scoreHeader.closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("starts from defaultSort and offers the same sorts as a select for cards", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        defaultSort={{ key: "score", dir: "desc" }}
      />
    );
    expect(bodyNames(screen.getByRole("table"))).toEqual(["Gamma", "Beta", "alpha"]);

    const select = screen.getByLabelText("Sort by");
    expect(select).toHaveValue("score:desc");
    fireEvent.change(select, { target: { value: "name:asc" } });
    expect(bodyNames(screen.getByRole("table"))).toEqual(["alpha", "Beta", "Gamma"]);
  });

  it("shows no sort controls when no column is sortable", () => {
    render(
      <DataTable
        columns={columns.map((c) => ({ ...c, sortValue: undefined }))}
        rows={rows}
        rowKey={(r) => r.id}
      />
    );
    expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Score/ })).not.toBeInTheDocument();
  });
});
