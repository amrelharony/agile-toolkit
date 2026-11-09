/**
 * The compose form's live preview id. It used to be a random id made while
 * rendering, so the server's render and the browser's disagreed and React
 * warned "Prop data-kudos-id did not match" (the page kept the server's id
 * while the form sent the browser's). The first render now carries a fixed
 * placeholder, which the card leaves off, and the real id is set after mount.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Kudos } from "@/lib/stores/workspace-types";

vi.mock("@/lib/kudos/llm/sentiment", () => ({
  analyseSentiment: vi.fn(async () => null),
}));

import { KudosForm, type RecipientOption } from "@/app/(tools)/kudos/components/kudos-form";
import { PENDING_KUDOS_ID } from "@/app/(tools)/kudos/components/kudos-card";

const recipients: RecipientOption[] = [{ id: "team:1", displayName: "Sam", source: "team" }];
const REAL_ID = /^kud_[0-9a-f]{16}$/;

function Form({ onSubmit = () => {} }: { onSubmit?: (k: Kudos) => void }) {
  return (
    <KudosForm
      defaultFromName="Ada"
      recipients={recipients}
      onSubmit={onSubmit}
      onDownload={() => {}}
    />
  );
}

const previewCard = (root: ParentNode) => root.querySelector<HTMLElement>("[data-kudos-id]");

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("the kudos preview id", () => {
  it("is the placeholder on the first render, which the card leaves off", () => {
    const html = renderToString(<Form />);
    // includes() keeps a failure from printing the whole form.
    expect(html.includes("data-kudos-id")).toBe(false);
    expect(html.includes(PENDING_KUDOS_ID)).toBe(false);
    // Nothing random is left in the first render, so two of them agree.
    expect(renderToString(<Form />)).toBe(html);
  });

  it("hydrates without a mismatch, then gets a real id after mount", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Form />);
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Form />);
    });

    const mismatches = errors.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((line) => /did not match|hydrat/i.test(line));
    expect(mismatches).toEqual([]);
    expect(previewCard(container)?.dataset.kudosId).toMatch(REAL_ID);
    act(() => root?.unmount());
  });

  it("sends the id the preview shows, and starts the next card on a fresh one", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<Form onSubmit={onSubmit} />);
    const shown = previewCard(container)?.dataset.kudosId;
    expect(shown).toMatch(REAL_ID);

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:1" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].id).toBe(shown);
    await waitFor(() => expect(previewCard(container)?.dataset.kudosId).not.toBe(shown));
    expect(previewCard(container)?.dataset.kudosId).toMatch(REAL_ID);
  });
});
