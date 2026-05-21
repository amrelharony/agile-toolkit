import type { Metadata } from "next";
import { ModelCardClient } from "./model-card-client";

export const metadata: Metadata = {
  title: "Model Card Builder — Agile Toolkit",
  description:
    "Templated model documentation: intended use, training data, evaluation, biases & limitations, license.",
};

export default function Page() {
  return <ModelCardClient />;
}
