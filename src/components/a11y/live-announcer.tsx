"use client";

import * as React from "react";

type Politeness = "polite" | "assertive";
type Announce = (message: string, politeness?: Politeness) => void;

const AnnounceContext = React.createContext<Announce>(() => {});

/**
 * One pair of live regions for the whole app.
 *
 * Status changes that only appear visually — a timer reaching zero, votes
 * revealed, "Deleted · Undo", an AI answer finishing — were never announced
 * to screen readers (WCAG 4.1.3). Components call `useAnnounce()` instead
 * of mounting their own regions, which screen readers often miss when the
 * region and its text appear in the same render.
 */
export function LiveAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = React.useState("");
  const [assertive, setAssertive] = React.useState("");

  const timers = React.useRef(new Set<number>());

  const announce = React.useCallback<Announce>((message, politeness = "polite") => {
    const set = politeness === "assertive" ? setAssertive : setPolite;
    // Clear first so repeating the same message is announced again.
    set("");
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      set(message);
    }, 50);
    timers.current.add(timer);
  }, []);

  // A timer left running past unmount fires with nothing to announce to, and
  // in a test run it can fire after the DOM is gone and fail the whole job.
  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {polite}
      </div>
      <div
        className="sr-only"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="live-assertive"
      >
        {assertive}
      </div>
    </AnnounceContext.Provider>
  );
}

/** `announce("Votes revealed")`, or `announce("Time's up", "assertive")`. */
export function useAnnounce(): Announce {
  return React.useContext(AnnounceContext);
}
