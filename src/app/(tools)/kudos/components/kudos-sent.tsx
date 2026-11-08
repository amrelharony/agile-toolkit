"use client";

/**
 * What a visitor gets for a sent kudos: the card, a link that holds it and a
 * card image, to pass on however they like. Nothing reaches a server: the
 * link carries the card after its `#` (lib/kudos/card-link), and the image is
 * drawn here on white, like the printed cards.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Kudos } from "@/lib/stores/workspace-types";
import { cardLink } from "@/lib/kudos/card-link";
import {
  type CardImageOptions,
  canShareImage,
  cardImage,
  cardImageName,
  downloadBlob,
  SHARE_IMAGE_OPTIONS,
  shareCardImage,
  warmCardImage,
} from "@/lib/kudos/card-image";
import { KudosCard } from "./kudos-card";

interface Props {
  kudos: Kudos;
  /** Whether a copy was kept on this device. */
  kept: boolean;
  /** Close the panel, to write another. */
  onDone: () => void;
}

export function KudosSent({ kudos, kept, onDone }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareable, setShareable] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    setShareable(canShareImage());
    let current = true;
    cardLink(kudos, window.location.origin)
      .then((made) => {
        if (current) setLink(made);
      })
      .catch(() => {
        if (current) setProblem("This browser can't make the link. Download the image instead.");
      });
    return () => {
      current = false;
    };
  }, [kudos]);

  // The image's sharper panel, fetched while they read: Share has only a few
  // seconds after the click to open the sheet.
  useEffect(() => {
    if (!cardRef.current) return;
    return warmCardImage(cardRef.current);
  }, [kudos]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setProblem("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  const image = async (options?: CardImageOptions) => {
    if (!cardRef.current) throw new Error("no card");
    return cardImage(cardRef.current, options);
  };

  const download = async () => {
    try {
      downloadBlob(await image(), cardImageName(kudos.toName));
    } catch {
      setProblem("Couldn't make the image. Try again, or send the link.");
    }
  };

  const share = async () => {
    try {
      const blob = await image(SHARE_IMAGE_OPTIONS);
      await shareCardImage(blob, cardImageName(kudos.toName), link ?? "");
    } catch {
      setProblem("Couldn't open the share sheet. Copy the link or download the image.");
    }
  };

  return (
    <section
      aria-labelledby="kudos-sent-title"
      className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-surface p-4"
    >
      <h2
        id="kudos-sent-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold text-text focus:outline-none"
      >
        Your kudos for {kudos.toName} is ready
      </h2>
      <p role="status" className="text-sm text-text">
        {kept
          ? "A copy is kept on this device. Send the link or the image to pass it on."
          : "Nothing was saved. Send the link or the image to pass it on."}
      </p>
      {/* On a touch screen the link and Copy link / Share come first, right
          under the heading: the card is at least a face tall (423 px) and both
          faces stack below 640 px of panel, so they sat a screen or more below
          it. That holds for a landscape phone and a tablet too, which are
          wider than sm, so the card comes first again only with a mouse or
          trackpad from sm up (desktop as before). The card has nothing to
          focus, so the Tab order is the same either way, and a screen reader
          on a phone reaches the actions in the order it sees. */}
      <div className="flex flex-col gap-4 pointer-fine:sm:order-last">
        {link ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="kudos-link" className="text-sm font-medium text-sub">
              Link to this card
            </label>
            <input
              id="kudos-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 w-full min-w-0 rounded-md border border-border bg-surface-deep px-3 text-sm text-text"
            />
            <p className="text-xs text-sub">
              Anyone with the link can see the card, so send it only to the person you&apos;re
              thanking.
            </p>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={copy} disabled={!link} className="gap-2">
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? "Link copied" : "Copy link"}
          </Button>
          {shareable ? (
            <Button type="button" variant="outline" onClick={share} className="gap-2">
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={download} className="gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Download image
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Write another
          </Button>
        </div>
      </div>
      <div className="flex justify-center">
        <KudosCard ref={cardRef} kudos={kudos} excludeInteractive />
      </div>
    </section>
  );
}
