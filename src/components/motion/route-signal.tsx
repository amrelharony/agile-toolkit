"use client";

/**
 * Tells page changes (lib/motion/page-transition.ts) that the new page is in
 * place, and lends them the app router. The shell renders it in both of its
 * branches, inside its own Suspense: useSearchParams on a static page renders
 * up to the nearest Suspense in the browser, and this boundary holds only
 * this component. The query counts because stories are /comics?ep=N.
 *
 * The arrival is reported from a layout effect, in the commit that puts the
 * new page in place and before the browser takes its new picture; never from
 * a frame callback, which the browser pauses while it holds the old picture.
 *
 * Back and Forward: listeners that only read (listenForHistorySteps), so a
 * card can slide back into its place once its page is back. The Navigation
 * API's navigate event measures the leaving page: it comes before any
 * popstate listener, and Chrome runs a window's popstate listeners in the
 * order they were added, capture or not, so Next's own (added first) has put
 * the old page back before a popstate listener of this one runs. The popstate
 * listener only confirms; it never stops the event or prevents its default,
 * and Next restores the page in its own listener.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  listenForHistorySteps,
  notifyRouteCommitted,
  readDebugSwitches,
  registerNavigator,
} from "@/lib/motion/page-transition";

// The ?vt-log=1 table: its code loads only when the switch is on.
const VtLog = lazy(() => import("./vt-log"));

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function RouteSignal({ isBare }: { isBare?: (pathname: string) => boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const query = useSearchParams()?.toString() ?? "";
  const href = query ? `${pathname}?${query}` : pathname;
  const [showLog, setShowLog] = useState(false);

  useIsomorphicLayoutEffect(() => registerNavigator(router, isBare), [router, isBare]);
  useIsomorphicLayoutEffect(() => notifyRouteCommitted(href), [href]);
  useEffect(() => listenForHistorySteps(), []);
  // The switches can arrive with any address, so read them on each one.
  useEffect(() => setShowLog(readDebugSwitches().log), [href]);

  return showLog ? (
    // Its own boundary: while its code loads, the effects above stay in place.
    <Suspense fallback={null}>
      <VtLog />
    </Suspense>
  ) : null;
}
