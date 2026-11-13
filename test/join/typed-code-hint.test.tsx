import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A bare code typed at /join makes the person pick the tool; a wrong pick
 * opens an empty room that just waits. Both rooms a typed code can open
 * (Poker, Retro) then say what to check and link back to /join with the
 * code filled in.
 */

import { TypedCodeHint } from "@/components/collab/typed-code-hint";

const CODE = "ABCDEFGHJKMN";
const ROOT = join(__dirname, "..", "..");

afterEach(() => vi.useRealTimers());

describe("TypedCodeHint", () => {
  it("names the tool to check and links back to /join with the code filled in", () => {
    render(<TypedCodeHint code={CODE} toolName="Planning Poker" />);
    expect(screen.getByText(/Check that the host's screen says Planning Poker/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "type it again and pick another room" })
    ).toHaveAttribute("href", `/join?code=${CODE}`);
  });

  it("waits before showing, when asked to", () => {
    vi.useFakeTimers();
    render(<TypedCodeHint code={CODE} toolName="Retro" afterMs={20_000} />);
    expect(screen.queryByRole("link")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", `/join?code=${CODE}`);
  });

  it.each([
    ["Planning Poker", "src/app/(tools)/planning-poker/visitor-poker-room.tsx"],
    ["Retro", "src/app/(tools)/retro/room/visitor-retro-room.tsx"],
  ])("the %s room shows it while it waits for a host", (name, file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).toMatch(new RegExp(`<TypedCodeHint code=\\{code\\} toolName="${name}"`));
  });
});
