import type { Metadata } from "next";
import { BurnupClient } from "./burnup-client";

export const metadata: Metadata = {
  title: "Burnup Generator",
  description:
    "Interactive sprint burnup chart showing total scope vs. completed work with scope creep visualization.",
};

export default function BurnupPage() {
  return <BurnupClient />;
}
