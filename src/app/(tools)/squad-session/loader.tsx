"use client";

import dynamic from "next/dynamic";

/**
 * The page's only client import, so a locked page's chunks hold just this line
 * and the tool's own code is a separate file fetched when this renders.
 */
export const SquadSessionLoader = dynamic(() =>
  import("./squad-session-client").then((m) => m.SquadSessionClient)
);
