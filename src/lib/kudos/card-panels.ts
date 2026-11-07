/**
 * Each printed kudos card's comic panel, as the site shows it on the card's
 * front. The 28 square WebP files (360 px and 720 px) live in the public
 * `comic-panels` bucket under `kudos-cards/`, never in git; the hash in each
 * name changes when the art does, so the files can be cached for good. They
 * are for kudos cards only: the comics pages never show a book episode's art.
 * Pure, and free of client modules: the MCP server may read it too.
 */

import { panelImageUrl } from "@/lib/comics/images";
import type { CardDesignKey } from "./card-designs";

export type CardPanelSize = "small" | "large";

export const CARD_PANEL_PATHS: Record<CardDesignKey, Record<CardPanelSize, string>> = {
  "ep-01": {
    small: "kudos-cards/ep-01.9253bdbee9.360.webp",
    large: "kudos-cards/ep-01.de455bc81c.720.webp",
  },
  "ep-02": {
    small: "kudos-cards/ep-02.8a7a7210e3.360.webp",
    large: "kudos-cards/ep-02.f806a58530.720.webp",
  },
  "ep-03": {
    small: "kudos-cards/ep-03.5c95f904b4.360.webp",
    large: "kudos-cards/ep-03.be8702e561.720.webp",
  },
  "ep-04": {
    small: "kudos-cards/ep-04.99e3410620.360.webp",
    large: "kudos-cards/ep-04.3c70a0983e.720.webp",
  },
  "ep-05": {
    small: "kudos-cards/ep-05.91b7ae581d.360.webp",
    large: "kudos-cards/ep-05.02d9bbafca.720.webp",
  },
  "ep-06": {
    small: "kudos-cards/ep-06.d0147013ad.360.webp",
    large: "kudos-cards/ep-06.53ecfa2acb.720.webp",
  },
  "ep-07": {
    small: "kudos-cards/ep-07.368cc77341.360.webp",
    large: "kudos-cards/ep-07.852c87dbdd.720.webp",
  },
  "ep-08": {
    small: "kudos-cards/ep-08.4199849687.360.webp",
    large: "kudos-cards/ep-08.a5e6640d0d.720.webp",
  },
  "ep-09": {
    small: "kudos-cards/ep-09.3235fadaa2.360.webp",
    large: "kudos-cards/ep-09.d54670ebcc.720.webp",
  },
  "ep-10": {
    small: "kudos-cards/ep-10.153961bf0c.360.webp",
    large: "kudos-cards/ep-10.ec1d9b4eb0.720.webp",
  },
  "ep-11": {
    small: "kudos-cards/ep-11.a21feb6432.360.webp",
    large: "kudos-cards/ep-11.b95c6d982a.720.webp",
  },
  "ep-12": {
    small: "kudos-cards/ep-12.4f5453a4d9.360.webp",
    large: "kudos-cards/ep-12.0278894800.720.webp",
  },
  "ep-13": {
    small: "kudos-cards/ep-13.698c385e70.360.webp",
    large: "kudos-cards/ep-13.1a4aa2d256.720.webp",
  },
  "ep-14": {
    small: "kudos-cards/ep-14.5502c3570e.360.webp",
    large: "kudos-cards/ep-14.2ea936e6be.720.webp",
  },
  "ep-15": {
    small: "kudos-cards/ep-15.bbc2e8091e.360.webp",
    large: "kudos-cards/ep-15.12f5053bc9.720.webp",
  },
  "ep-16": {
    small: "kudos-cards/ep-16.da15825ef2.360.webp",
    large: "kudos-cards/ep-16.e87584da49.720.webp",
  },
  "ep-17": {
    small: "kudos-cards/ep-17.52f3f0dc37.360.webp",
    large: "kudos-cards/ep-17.3ce11c4f21.720.webp",
  },
  "ep-18": {
    small: "kudos-cards/ep-18.b32d302ba6.360.webp",
    large: "kudos-cards/ep-18.bdef397d27.720.webp",
  },
  "ep-19": {
    small: "kudos-cards/ep-19.4b22f05ba1.360.webp",
    large: "kudos-cards/ep-19.e1d39a769e.720.webp",
  },
  "ep-20": {
    small: "kudos-cards/ep-20.621184c910.360.webp",
    large: "kudos-cards/ep-20.112c688994.720.webp",
  },
  "ep-21": {
    small: "kudos-cards/ep-21.1255d83047.360.webp",
    large: "kudos-cards/ep-21.1336782c72.720.webp",
  },
  "ep-22": {
    small: "kudos-cards/ep-22.582b5b3bee.360.webp",
    large: "kudos-cards/ep-22.11402e6757.720.webp",
  },
  "ep-23": {
    small: "kudos-cards/ep-23.a07997fa19.360.webp",
    large: "kudos-cards/ep-23.6bd4139ec1.720.webp",
  },
  "ep-24": {
    small: "kudos-cards/ep-24.b091de7999.360.webp",
    large: "kudos-cards/ep-24.4f67bc926a.720.webp",
  },
  "ep-25": {
    small: "kudos-cards/ep-25.d310993c47.360.webp",
    large: "kudos-cards/ep-25.c751e45d6b.720.webp",
  },
  "ep-26": {
    small: "kudos-cards/ep-26.ddf04ffc1c.360.webp",
    large: "kudos-cards/ep-26.6f53d47516.720.webp",
  },
  "open-thank-you": {
    small: "kudos-cards/open-thank-you.597a040d3d.360.webp",
    large: "kudos-cards/open-thank-you.af7c91a419.720.webp",
  },
  "open-teamwork": {
    small: "kudos-cards/open-teamwork.c71dcf9466.360.webp",
    large: "kudos-cards/open-teamwork.3e31c512ed.720.webp",
  },
};

/**
 * The panel's public address, or null when the site has no Supabase address
 * (tests, a local-only run): the card then shows a plain square instead of a
 * broken relative link.
 */
export function cardPanelUrl(key: CardDesignKey, size: CardPanelSize): string | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return null;
  return panelImageUrl(CARD_PANEL_PATHS[key][size]);
}
