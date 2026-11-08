"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FIRST_WEEKLY_EP } from "@/lib/comics/entry";
import { beaconStats } from "@/lib/comics/stats-client";
import { useCounting } from "./use-counting";

/**
 * The link to a story's tool under "Take it to your team". A click on a weekly
 * story's link is counted anonymously (lib/comics/stats): which stories send
 * readers on to try something is one of the owner's signals.
 */
export function ToolLink({
  ep,
  href,
  children,
}: {
  ep: number;
  href: string;
  children: ReactNode;
}) {
  const counting = useCounting();
  return (
    <Link
      href={href}
      className="font-medium text-accent underline"
      onClick={() => {
        if (counting && ep >= FIRST_WEEKLY_EP) beaconStats(ep, ["tool"]);
      }}
    >
      {children}
    </Link>
  );
}
