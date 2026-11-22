import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PersonaLibraryClient } from "./persona-library-client";

export const metadata: Metadata = toolMetadata("persona-library");

export default function Page() {
  return <PersonaLibraryClient />;
}
