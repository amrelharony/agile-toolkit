import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";

/** A page hears its query string on load and on a same-page link, not only on mount. */

afterEach(() => window.history.replaceState(null, "", "/"));

describe("OnSearchParams", () => {
  it("calls back on load and again when a client navigation changes the query", () => {
    const onChange = vi.fn();
    const at = (q: string) => (
      <SearchParamsContext.Provider value={new URLSearchParams(q)}>
        <OnSearchParams onChange={onChange} />
      </SearchParamsContext.Provider>
    );
    const { rerender } = render(at("id=a"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].get("id")).toBe("a");
    // The same query (a re-render) is not a new link.
    rerender(at("id=a"));
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(at("id=b"));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].get("id")).toBe("b");
  });

  it("reads window.location once outside the app router", () => {
    window.history.replaceState(null, "", "/x?matrix=m1");
    const onChange = vi.fn();
    render(<OnSearchParams onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].get("matrix")).toBe("m1");
  });

  it("dropSearchParam removes one param and keeps the rest of the address", () => {
    window.history.replaceState(null, "", "/decision-log?id=a&x=1#decision-a");
    dropSearchParam("id");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/decision-log?x=1#decision-a"
    );
    dropSearchParam("missing");
    expect(window.location.search).toBe("?x=1");
  });
});
