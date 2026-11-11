/**
 * RouteSignal must report the arrival in the commit that puts the new page in
 * place (a layout effect), before the browser takes its new picture. A
 * passive effect can run after that picture, so the cross-fade would wait for
 * its cap. The order React gives: within one commit every layout effect runs
 * before any passive one, and siblings run in order, so a later sibling's
 * layout effect sees the report only if RouteSignal sent it from a layout
 * effect. Its own file, as it wraps the real notifyRouteCommitted to count calls.
 */
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("@/lib/motion/page-transition", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/motion/page-transition")>();
  return { ...real, notifyRouteCommitted: vi.fn(real.notifyRouteCommitted) };
});

import { RouteSignal } from "@/components/motion/route-signal";
import { notifyRouteCommitted } from "@/lib/motion/page-transition";

const reported = () => vi.mocked(notifyRouteCommitted).mock.calls.map((c) => c[0]);

/** Records, from its own layout effect, what RouteSignal had reported by then. */
function Probe({ seen }: { seen: string[][] }) {
  useLayoutEffect(() => {
    seen.push(reported());
  });
  return null;
}

afterEach(() => {
  cleanup();
  nav.pathname = "/";
  nav.search = "";
});

describe("RouteSignal's arrival report", () => {
  it("is sent before a later sibling's layout effects in the same commit", () => {
    vi.mocked(notifyRouteCommitted).mockClear();
    const seen: string[][] = [];
    const tree = () => (
      <>
        <RouteSignal />
        <Probe seen={seen} />
      </>
    );
    const { rerender } = render(tree());
    expect(seen.at(-1)).toEqual(["/"]);

    nav.pathname = "/comics";
    nav.search = "ep=30";
    rerender(tree());
    expect(seen.at(-1)).toEqual(["/", "/comics?ep=30"]);
  });
});
