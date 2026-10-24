import type { Metadata } from "next";
import { cookies } from "next/headers";
import { COLOR_EDITION_TITLE, colorEditionAsset } from "@/lib/comic/agile-at-work";
import { COLOR_EDITION_COOKIE, isColorEditionKey } from "@/lib/comic/color-edition-access";
import { ColorEditionClient, type ColorEditionAccess } from "./color-edition-client";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: COLOR_EDITION_TITLE,
  description: "The colour edition of the Agile at Work comic, for readers of the printed book.",
  robots: { index: false, follow: false },
};

/**
 * /agile-at-work/color — the private colour edition. The QR link in the book
 * (./[key]/route.ts) sets the cookie checked here; without it the visitor is
 * told how to get in. Only an unlocked visitor is handed the PDF's URL.
 */
export default async function ColorEditionPage({
  searchParams,
}: {
  searchParams: { link?: string | string[] };
}) {
  const unlocked = await isColorEditionKey(cookies().get(COLOR_EDITION_COOKIE)?.value);
  const access: ColorEditionAccess = unlocked
    ? "unlocked"
    : searchParams.link === "invalid"
      ? "invalid-link"
      : "locked";
  return <ColorEditionClient access={access} asset={unlocked ? colorEditionAsset() : null} />;
}
