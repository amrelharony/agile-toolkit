import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { PeoplePicker, PersonPicker } from "@/components/team/person-picker";
import { addToRoster, findRosterMember } from "@/lib/team/use-team-roster";

/**
 * People come from the Team roster, free text still works, and adding
 * someone to the team is an explicit click — never a side effect of typing.
 */

const roster = () => useWorkspaceStore.getState().teamMembers;

function One() {
  const [name, setName] = useState("");
  return <PersonPicker label="Owner" value={name} onChange={setName} />;
}

function Many({ everyone = false }: { everyone?: boolean }) {
  const [names, setNames] = useState<string[]>([]);
  return (
    <>
      <PeoplePicker label="Approvers" values={names} onChange={setNames} offerEveryone={everyone} />
      <output data-testid="names">{names.join("|")}</output>
    </>
  );
}

beforeEach(() => {
  useWorkspaceStore.setState({
    teamMembers: [
      { id: "m1", name: "Priya" },
      { id: "m2", name: "Sam" },
    ],
  });
});

describe("PersonPicker", () => {
  it("suggests roster names", () => {
    const { container } = render(<One />);
    const listId = screen.getByLabelText("Owner").getAttribute("list")!;
    const options = Array.from(container.querySelectorAll<HTMLOptionElement>("datalist option"));
    expect(container.querySelector("datalist")?.id).toBe(listId);
    expect(options.map((o) => o.value)).toEqual(["Priya", "Sam"]);
  });

  it("accepts a name that isn't on the team without changing the team", () => {
    render(<One />);
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Lee" } });
    expect(screen.getByText("“Lee” isn’t on the team.")).toBeInTheDocument();
    expect(roster()).toHaveLength(2);
  });

  it("adds the typed name to the team only when asked", () => {
    render(<One />);
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "  Lee " } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(roster().map((m) => m.name)).toEqual(["Priya", "Sam", "Lee"]);
    expect(screen.getByLabelText("Owner")).toHaveValue("Lee");
    expect(screen.queryByText(/isn’t on the team/)).not.toBeInTheDocument();
  });

  it("says nothing for a roster name, whatever its case", () => {
    render(<One />);
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "priya" } });
    expect(screen.queryByText(/isn’t on the team/)).not.toBeInTheDocument();
  });

  it("points at the Team page when the roster is empty", () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    render(<One />);
    expect(screen.getByRole("link", { name: "Team page" })).toHaveAttribute("href", "/team");
  });

  it("grows the Team page link's tap area on touch only, without moving a line", () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    render(<One />);
    const classes = (screen.getByRole("link", { name: "Team page" }).getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    // Each padding is cancelled by a matching negative margin, so the
    // line height stays: 4 + 16 + 6 = 26 px, above the 24 px floor.
    expect(classes).toEqual(
      expect.arrayContaining([
        "pointer-coarse:inline-block",
        "pointer-coarse:pt-1",
        "pointer-coarse:-mt-1",
        "pointer-coarse:pb-1.5",
        "pointer-coarse:-mb-1.5",
      ])
    );
    // Up no further than the 4 px gap to the input above, down no further
    // than the 6 px gap to the inline editors' Save/Cancel row, so the link
    // never reaches into either.
    const grow = (side: "t" | "b") =>
      classes
        .filter((c) => c.startsWith(`pointer-coarse:p${side}-`))
        .map((c) => Number(c.slice(`pointer-coarse:p${side}-`.length)) * 4);
    expect(grow("t")).toEqual([4]);
    expect(grow("b")).toEqual([6]);
    expect(classes.filter((c) => /^pointer-coarse:(p[ytb]?|-?m[ytb]?)-/.test(c))).toHaveLength(4);
    // A mouse gets the plain inline link it had.
    expect(classes.filter((c) => !c.includes(":"))).toEqual(["text-accent", "underline-offset-2"]);
  });
});

describe("PeoplePicker", () => {
  it("adds on Enter with the roster's spelling and skips duplicates", () => {
    render(<Many />);
    const input = screen.getByLabelText("Approvers");
    fireEvent.change(input, { target: { value: "sam" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "SAM" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Lee" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Approvers" }));
    expect(screen.getByTestId("names")).toHaveTextContent("Sam|Lee");
    expect(input).toHaveValue("");
  });

  it("removes a chip", () => {
    render(<Many />);
    const input = screen.getByLabelText("Approvers");
    fireEvent.change(input, { target: { value: "Priya" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Priya" }));
    expect(screen.getByTestId("names")).toHaveTextContent("");
  });

  it("adds everyone still missing in one click", () => {
    render(<Many everyone />);
    const input = screen.getByLabelText("Approvers");
    fireEvent.change(input, { target: { value: "Sam" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add everyone on the team (1)" }));
    expect(screen.getByTestId("names")).toHaveTextContent("Sam|Priya");
    expect(screen.queryByRole("button", { name: /Add everyone/ })).not.toBeInTheDocument();
  });
});

describe("roster helpers", () => {
  it("finds members case-insensitively and doesn't add a duplicate", () => {
    expect(findRosterMember(roster(), " PRIYA ")?.id).toBe("m1");
    expect(findRosterMember(roster(), "")).toBeUndefined();
    expect(addToRoster("sam").id).toBe("m2");
    expect(roster()).toHaveLength(2);
  });
});
