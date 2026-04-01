import type { Metadata } from "next";
import { RefinementClient } from "./refinement-client";

export const metadata: Metadata = {
  title: "Refinement Checklist",
  description:
    "Interactive Definition of Ready checklist with per-story tracking, history table, and pass-rate trend chart.",
};

export default function RefinementPage() {
  return <RefinementClient />;
}
