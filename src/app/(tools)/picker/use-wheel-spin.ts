"use client";

/**
 * The wheel on the Picker page: how far it is turned, whether it is turning,
 * and what it shows while it does. A spin turns it for about 2.5 s from
 * where it stopped last time (so it always turns forward), then calls the
 * spin's `land`, which saves the pick. Under reduced motion it lands at once.
 *
 * While it turns, the wheel shows the names as they were when it started, so
 * a change arriving mid-spin (a sync, another tab) can't move the slices out
 * from under the pointer. Leaving the page mid-spin lands it straight away,
 * so the pick is never lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { SPIN_MS, landingRotation, wheelSlices } from "@/lib/picker/wheel";

/** What the wheel draws for one spin. */
export interface WheelPicture {
  names: string[];
  weights: number[];
  out: number[];
}

export interface SpinRequest {
  picture: WheelPicture;
  winner: number;
  turns: number;
  offset: number;
  /** Runs once, when the wheel stops. */
  land: () => void;
}

/** The turn starts a moment after the first paint, so the wheel visibly leaves its start. */
const START_DELAY_MS = 30;

type Timers = { current: ReturnType<typeof setTimeout>[] };

function clearTimers(timers: Timers) {
  timers.current.forEach(clearTimeout);
  timers.current = [];
}

export interface WheelSpin {
  rotation: number;
  spinning: boolean;
  /** The picture of the spin on screen (turning, or stopped on its winner), or null. */
  picture: WheelPicture | null;
  /** The slice the last spin stopped on, once it stopped. */
  winner: number | null;
  /** Start a spin; false while one is turning. */
  start: (request: SpinRequest) => boolean;
  /** Forget the stopped spin, so the wheel shows the names as they are now. */
  release: () => void;
}

export function useWheelSpin(): WheelSpin {
  const reduced = usePrefersReducedMotion();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [picture, setPicture] = useState<WheelPicture | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const rotationRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pending = useRef<(() => void) | null>(null);

  const start = useCallback(
    (req: SpinRequest): boolean => {
      if (pending.current) return false;
      const target = landingRotation(
        wheelSlices(req.picture.weights),
        req.winner,
        req.turns,
        req.offset,
        rotationRef.current
      );
      rotationRef.current = target;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pending.current = null;
        clearTimers(timers);
        setRotation(target);
        setSpinning(false);
        setWinner(req.winner);
        req.land();
      };
      setPicture(req.picture);
      setWinner(null);
      if (reduced) {
        finish();
        return true;
      }
      pending.current = finish;
      setSpinning(true);
      timers.current.push(
        setTimeout(() => setRotation(target), START_DELAY_MS),
        setTimeout(finish, START_DELAY_MS + SPIN_MS)
      );
      return true;
    },
    [reduced]
  );

  const release = useCallback(() => {
    if (pending.current) return;
    setPicture(null);
    setWinner(null);
  }, []);

  // Leaving mid-spin: land it now, so the pick is saved.
  useEffect(
    () => () => {
      clearTimers(timers);
      pending.current?.();
    },
    []
  );

  return { rotation, spinning, picture, winner, start, release };
}
