"use client";

import dynamic from "next/dynamic";

/**
 * The page's only client import, so a locked page's chunks hold just this line
 * and the tool's own code is a separate file fetched when this renders.
 */
export const MeetTheCastLoader = dynamic(() =>
  import("./meet-the-cast-client").then((m) => m.MeetTheCastClient)
);
