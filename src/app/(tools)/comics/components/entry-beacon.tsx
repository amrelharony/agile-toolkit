"use client";

import { useEffect, useRef } from "react";
import { parseBuilding } from "@/lib/comics/entry";
import { isDirectArrival, sendEntryBeacon } from "@/lib/comics/entry-beacon";

type EntryBeaconProps = { entry: "poster"; ep: number } | { entry: "direct" };

/**
 * Sends the anonymous entry count once. The pages are static, so the poster's
 * building can only be read here, from the address the browser is showing.
 */
export function EntryBeacon(props: EntryBeaconProps) {
  const sent = useRef(false);
  const ep = props.entry === "poster" ? props.ep : null;

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (ep === null) {
      if (isDirectArrival()) sendEntryBeacon({ entry: "direct" });
      return;
    }
    const b = parseBuilding(new URLSearchParams(window.location.search).getAll("b"));
    if (b !== null) sendEntryBeacon({ entry: "poster", ep, b });
  }, [ep]);

  return null;
}

/** Says what the beacon does, wherever one is on the page. */
export function CountDisclosure() {
  return (
    <p className="text-xs text-sub">
      This page sends us one anonymous count a day: which way you came in, and for a poster, its
      episode and building. There are no cookies, and we don&apos;t store IP addresses. A small note
      in this browser stops it counting twice.
    </p>
  );
}
