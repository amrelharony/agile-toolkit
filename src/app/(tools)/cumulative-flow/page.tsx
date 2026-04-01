import type { Metadata } from "next";
import { CFDClient } from "./cfd-client";

export const metadata: Metadata = {
  title: "Cumulative Flow Diagram",
  description:
    "Stacked area chart for flow efficiency, bottleneck detection, and WIP analysis across your workflow stages.",
};

export default function CFDPage() {
  return <CFDClient />;
}
