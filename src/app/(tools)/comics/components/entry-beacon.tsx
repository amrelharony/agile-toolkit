"use client";

import { useEffect, useRef } from "react";
import { isDirectArrival, sendEntryBeacon } from "@/lib/comics/entry-beacon";

/** Sends the anonymous entry count once, read from the address the browser shows. */
export function EntryBeacon({ entry }: { entry: "direct" }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (isDirectArrival()) sendEntryBeacon({ entry });
  }, [entry]);

  return null;
}

/** Says what the beacon does, wherever one is on the page. */
export function CountDisclosure() {
  return (
    <p className="text-xs text-sub">
      This page sends us one anonymous count a day of which way you came in. There are no cookies,
      and we don&apos;t store IP addresses. A small note in this browser stops it counting twice.
    </p>
  );
}
