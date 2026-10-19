import type { Metadata } from "next";
import { StaceyMatrixClient } from "./stacey-matrix-client";

export const metadata: Metadata = {
  title: "Stacey Matrix",
  description:
    "Plot work on Certainty (how) vs Agreement (what) → Simple / Complicated / Complex / Chaotic regions.",
};

export default function Page() {
  return <StaceyMatrixClient />;
}
