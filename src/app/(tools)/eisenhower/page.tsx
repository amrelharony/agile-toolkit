import type { Metadata } from "next";
import { EisenhowerClient } from "./eisenhower-client";

export const metadata: Metadata = {
  title: "Eisenhower Matrix",
  description: "Plot tasks on Urgent vs Important axes; decide Do / Schedule / Delegate / Delete.",
};

export default function Page() {
  return <EisenhowerClient />;
}
