import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { AbCalculatorClient } from "./ab-calculator-client";

export const metadata: Metadata = toolMetadata("ab-calculator");

export default function Page() {
  return <AbCalculatorClient />;
}
