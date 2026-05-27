import type { Metadata } from "next";
import { KudosClient } from "./kudos-client";

export const metadata: Metadata = {
  title: "Kudos Wall",
  description:
    "Send themed recognition cards to your squad. Live updates across all peers, downloadable as PNG, attributed by squad profile.",
};

export default function KudosPage() {
  return <KudosClient />;
}
