import type { Metadata } from "next";
import { RACIClient } from "./raci-client";

export const metadata: Metadata = {
  title: "RACI Matrix Builder",
  description:
    "Build interactive RACI matrices to clarify roles and responsibilities across activities with validation and export.",
};

export default function RACIPage() {
  return <RACIClient />;
}
