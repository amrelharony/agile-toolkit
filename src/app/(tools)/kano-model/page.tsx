import type { Metadata } from "next";
import { KanoModelClient } from "./kano-model-client";

export const metadata: Metadata = {
  title: "Kano Model Builder",
  description:
    "Classify features as Must-Be / Performance / Attractive / Indifferent / Reverse via customer survey.",
};

export default function Page() {
  return <KanoModelClient />;
}
