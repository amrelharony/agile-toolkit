import type { Metadata } from "next";
import { ValueEffortMatrixClient } from "./value-effort-matrix-client";

export const metadata: Metadata = {
  title: "Value vs Effort Matrix",
  description:
    "A draggable 2x2 of value against effort: Quick Wins, Big Bets, Fill-Ins and Time Wasters.",
};

export default function Page() {
  return <ValueEffortMatrixClient />;
}
