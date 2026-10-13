import type { Metadata } from "next";
import { KudosClient } from "./kudos-client";

export const metadata: Metadata = {
  title: "Kudos Wall",
  description:
    "Send themed recognition cards to your team, downloadable as PNG for sharing outside the toolkit.",
};

export default function KudosPage() {
  return <KudosClient />;
}
