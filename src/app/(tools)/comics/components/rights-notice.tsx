import Link from "next/link";
import { LICENSE_PATH } from "@/lib/comics/rights";

/** Shown on every story and poster page. */
export function RightsNotice() {
  return (
    <p className="text-xs text-sub">
      © Amr Elharony. This comic is the private property of this website. It is free for individuals
      to use as it is, and companies need a licence.{" "}
      <Link href={LICENSE_PATH} prefetch={false} className="font-medium text-text underline">
        Read the licence
      </Link>
    </p>
  );
}
