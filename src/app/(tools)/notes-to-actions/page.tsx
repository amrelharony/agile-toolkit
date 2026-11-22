import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { NotesToActionsClient } from "./notes-to-actions-client";

export const metadata: Metadata = toolMetadata("notes-to-actions");

export default function Page() {
  return <NotesToActionsClient />;
}
