import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CardDecksClient } from "./card-decks-client";

export const metadata: Metadata = toolMetadata("card-decks");

export default function Page() {
  return <CardDecksClient />;
}
