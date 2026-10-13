import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Kudos } from "@/lib/stores/workspace-types";

/**
 * The kudos "From" field: read-only for the owner (and squad guests), whose
 * identity comes from their session, but an editable "Your name" input for a
 * signed-out visitor, who has no identity to show.
 */

vi.mock("@/lib/kudos/llm/sentiment", () => ({
  analyseSentiment: vi.fn(async () => null),
}));

import { KudosForm, type RecipientOption } from "@/app/(tools)/kudos/components/kudos-form";

const recipients: RecipientOption[] = [{ id: "team:1", displayName: "Sam", source: "team" }];

function VisitorForm({ onSubmit }: { onSubmit: (k: Kudos) => void }) {
  const [name, setName] = useState("");
  return (
    <KudosForm
      defaultFromName={name}
      fromPlaceholder="Your name"
      onFromNameChange={setName}
      recipients={recipients}
      onSubmit={onSubmit}
      onDownload={() => {}}
    />
  );
}

describe("KudosForm sender field", () => {
  it("is read-only when the parent supplies the identity", () => {
    render(
      <KudosForm
        defaultFromName="Owner Name"
        recipients={recipients}
        onSubmit={() => {}}
        onDownload={() => {}}
      />
    );
    const from = screen.getByDisplayValue("Owner Name");
    expect(from).toHaveAttribute("readonly");
    expect(screen.queryByPlaceholderText("Your name")).toBeNull();
  });

  it("lets a visitor type their name, which signs the kudos", async () => {
    const onSubmit = vi.fn();
    render(<VisitorForm onSubmit={onSubmit} />);

    const from = screen.getByLabelText("From");
    expect(from).not.toHaveAttribute("readonly");
    expect(from).toHaveAttribute("placeholder", "Your name");
    expect(from).toHaveAttribute("maxLength", "48");

    fireEvent.change(from, { target: { value: "Ada" } });
    expect(from).toHaveValue("Ada");

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /send kudos/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ fromName: "Ada", toName: "Sam" });
  });
});
