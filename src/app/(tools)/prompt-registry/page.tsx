import type { Metadata } from "next";
import { PromptRegistryClient } from "./prompt-registry-client";

export const metadata: Metadata = {
  title: "Prompt Registry",
  description:
    "Git-style versioning of prompts with branch / commit / approve and per-version eval-delta tracking.",
};

export default function Page() {
  return <PromptRegistryClient />;
}
