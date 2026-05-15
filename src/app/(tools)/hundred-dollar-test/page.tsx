import type { Metadata } from "next";
import { HundredDollarTestClient } from "./hundred-dollar-test-client";

export const metadata: Metadata = {
  title: "$100 Test — Agile Toolkit",
  description:
    "Cumulative voting — each participant allocates $100 across competing items, forcing critical tradeoffs.",
};

export default function Page() {
  return <HundredDollarTestClient />;
}
