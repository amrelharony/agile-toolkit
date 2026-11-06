"use client";

/**
 * A kudos card opened from its link (/kudos#k=…): the card, read-only, and a
 * way to send one of your own. The card comes out of the link itself, so
 * opening it asks nothing of a server and keeps nothing on this device.
 */

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Kudos } from "@/lib/stores/workspace-types";
import { isCardLinkHash, readCardLink } from "@/lib/kudos/card-link";
import { replaceUrl } from "@/components/shared/on-search-params";
import { KudosCard } from "./kudos-card";

type Opened = { kind: "card"; kudos: Kudos } | { kind: "broken"; message: string };

/** Drop the card from the address, so the page is the plain Kudos page again. */
function dropCardFromAddress() {
  const url = new URL(window.location.href);
  url.hash = "";
  replaceUrl(url);
}

export function KudosReceived({ onSendYourOwn }: { onSendYourOwn: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash;
      if (!isCardLinkHash(hash)) {
        setOpened(null);
        return;
      }
      readCardLink(hash)
        .then((kudos) => setOpened({ kind: "card", kudos }))
        .catch((err: unknown) =>
          setOpened({
            kind: "broken",
            message: err instanceof Error ? err.message : "This link is damaged.",
          })
        );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (opened) headingRef.current?.focus();
  }, [opened]);

  if (!opened) return null;

  const sendYourOwn = () => {
    dropCardFromAddress();
    setOpened(null);
    onSendYourOwn();
  };

  return (
    <section
      aria-labelledby="kudos-received-title"
      className="mb-6 flex flex-col gap-4 rounded-lg border border-accent/40 bg-surface p-4"
    >
      <h2
        id="kudos-received-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-text focus:outline-none"
      >
        {opened.kind === "card"
          ? `A kudos card for ${opened.kudos.toName}`
          : "This kudos link didn't open"}
      </h2>
      {opened.kind === "card" ? (
        <div className="flex justify-center">
          <KudosCard kudos={opened.kudos} excludeInteractive />
        </div>
      ) : (
        <p role="alert" className="text-sm text-text">
          {opened.message} Ask whoever sent it for the link again.
        </p>
      )}
      <div>
        <Button type="button" onClick={sendYourOwn} className="gap-2">
          <Send className="h-4 w-4" aria-hidden="true" />
          Send your own
        </Button>
      </div>
    </section>
  );
}
