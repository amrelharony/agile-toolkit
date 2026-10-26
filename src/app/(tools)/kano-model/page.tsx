import type { Metadata } from "next";
import { KanoModelClient } from "./kano-model-client";

export const metadata: Metadata = {
  title: "Kano Model Builder",
  description:
    "Ask customers how they'd feel with and without each feature; the Kano evaluation table derives Must-be, Performance, Attractive, Indifferent, Reverse or Questionable, with Better and Worse.",
};

export default function Page() {
  return <KanoModelClient />;
}
