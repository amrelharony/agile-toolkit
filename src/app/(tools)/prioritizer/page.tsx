import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PrioritizerClient } from "./prioritizer-client";

// The catalog's one-liner names only the four methods the hub edits; the
// page covers all seven it compares, and the order it decides.
export const metadata: Metadata = toolMetadata("prioritizer", {
  description:
    "The shared backlog: score items with MoSCoW, WSJF, RICE, Value vs Effort, ICE, Kano and Cost of Delay, compare the methods side by side, and decide one order for Sprint Planning.",
});

export default function PrioritizerPage() {
  return <PrioritizerClient />;
}
