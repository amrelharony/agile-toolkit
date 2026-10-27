"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

type OnChange = (search: URLSearchParams) => void;

/**
 * Calls `onChange` with the query string when the page loads and again on
 * every client navigation that changes it, a link to the same page
 * included (a next step's `?id=` on the page it opens). Reading
 * window.location once, on mount, misses those: the page doesn't remount.
 *
 * It renders nothing, inside its own Suspense boundary, so only this
 * listener (not the page) skips server rendering for useSearchParams.
 * Outside the app router (tests) it reads window.location once.
 */
export function OnSearchParams({ onChange }: { onChange: OnChange }) {
  return (
    <Suspense fallback={null}>
      <Listener onChange={onChange} />
    </Suspense>
  );
}

function Listener({ onChange }: { onChange: OnChange }) {
  const params = useSearchParams();
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = params ? params.toString() : null;
  useEffect(() => {
    latest.current(new URLSearchParams(key ?? window.location.search));
  }, [key]);
  return null;
}

/** Drops `name` from the address bar (after it was acted on), so the same link works again. */
export function dropSearchParam(name: string) {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* no history API: the param stays, which is harmless */
  }
}
