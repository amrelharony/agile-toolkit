import type { Metadata } from "next";
import { ValueEffortMatrixClient } from "./value-effort-matrix-client";

export const metadata: Metadata = {
  title: "Value vs Effort Matrix",
  description:
    "2x2 matrix plotting items into Quick Wins / Big Bets / Fill-Ins / Time Wasters quadrants.",
};

export default function Page() {
  return <ValueEffortMatrixClient />;
}
