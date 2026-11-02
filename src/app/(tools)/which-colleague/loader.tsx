"use client";

import dynamic from "next/dynamic";

/**
 * The page's only client import, so a locked page's chunks hold just this line
 * and the game's own code is a separate file fetched when this renders.
 */
export const WhichColleagueLoader = dynamic(() =>
  import("./which-colleague-client").then((m) => m.WhichColleagueClient)
);
