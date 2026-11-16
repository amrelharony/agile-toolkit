import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SmNotebookClient } from "./sm-notebook-client";

export const metadata: Metadata = toolMetadata("sm-notebook");

export default function Page() {
  return <SmNotebookClient />;
}
