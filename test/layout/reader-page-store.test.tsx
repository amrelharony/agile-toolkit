import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useReaderPage, useReaderPageStore } from "@/lib/stores/reader-page-store";

/**
 * A reader page announces itself to the shared chrome for exactly as long
 * as it is mounted, and before anything paints.
 */

function Reader({ title }: { title: string }) {
  useReaderPage(title);
  return null;
}

beforeEach(() => {
  useReaderPageStore.setState({ title: null });
});

describe("useReaderPage", () => {
  it("is null on every other page", () => {
    expect(useReaderPageStore.getState().title).toBeNull();
  });

  it("sets the title on mount, follows a change, and clears it on unmount", () => {
    const { rerender, unmount } = render(<Reader title="First" />);
    expect(useReaderPageStore.getState().title).toBe("First");

    rerender(<Reader title="Second" />);
    expect(useReaderPageStore.getState().title).toBe("Second");

    unmount();
    expect(useReaderPageStore.getState().title).toBeNull();
  });

  it("is set by the time a sibling's layout effects run", () => {
    let seen: string | null | undefined;
    function Chrome() {
      useLayoutEffect(() => {
        seen = useReaderPageStore.getState().title;
      }, []);
      return null;
    }
    render(
      <>
        <Reader title="A reader page" />
        <Chrome />
      </>
    );
    expect(seen).toBe("A reader page");
  });
});
