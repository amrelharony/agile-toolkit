import type { Metadata } from "next";
import { KanoModelClient } from "./kano-model-client";

export const metadata: Metadata = {
  title: "Kano Model Builder",
  description:
    "Classify features as Must-Be / Performance / Attractive / Indifferent / Reverse from customer research.",
};

export default function Page() {
  return <KanoModelClient />;
}
