import type { Metadata } from "next";
import { RefinementClient } from "./refinement-client";

export const metadata: Metadata = {
  title: "Refinement Checklist",
  description:
    "Backlog refinement session: check unready stories against your Definition of Ready, queue unsized ones for Planning Poker, and mark them ready.",
};

export default function RefinementPage() {
  return <RefinementClient />;
}
