import type { Metadata } from "next";
import { CountDisclosure, VisitRecorder } from "@/components/visits/visit-recorder";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { KudosClient } from "./kudos-client";

export const metadata: Metadata = toolMetadata("kudos");

/**
 * The print campaign's kudos wall sign and Scrum Master guide open this page
 * (/kudos?src=sign, ?src=guide), and so do the comics' own links (src=comics):
 * each arrival is counted, anonymously, and the address tidied.
 */
export default function KudosPage() {
  return (
    <>
      <VisitRecorder path="/kudos" />
      <KudosClient />
      <div className="mx-auto mt-6 max-w-5xl px-4 pb-6">
        <CountDisclosure />
      </div>
    </>
  );
}
