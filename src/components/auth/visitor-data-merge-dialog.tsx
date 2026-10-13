"use client";

import { useState } from "react";
import { CloudUpload, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  discardVisitorData,
  mergeVisitorData,
  setVisitorDataPromptOpen,
  useOwnerSyncGateStore,
  useVisitorDataPending,
  useVisitorDataTracker,
} from "@/lib/sync/owner-sync-gate";

/**
 * "Work created while signed out" — shown when the owner signs in on a
 * browser where a visitor (or the owner, signed out) saved tools data.
 * Cloud sync waits on the answer (see owner-sync-gate.ts). Mounted once
 * from the header, which also makes it the home of the visitor-write
 * tracker that sets the marker this dialog is about.
 *
 * Closing without answering is allowed ("decide later"): sync stays paused
 * and the header notice reopens the dialog.
 */
export function VisitorDataMergeDialog() {
  useVisitorDataTracker();
  const pending = useVisitorDataPending();
  const promptOpen = useOwnerSyncGateStore((s) => s.promptOpen);
  const [discarding, setDiscarding] = useState(false);

  const onDiscard = () => {
    setDiscarding(true);
    discardVisitorData();
    // The in-memory stores still hold the discarded data; a reload drops
    // them and lets sync start from the owner's cloud copy.
    window.location.reload();
  };

  return (
    <Dialog open={(pending && promptOpen) || discarding} onOpenChange={setVisitorDataPromptOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Work created while signed out</DialogTitle>
          <DialogDescription>
            This browser has tools data that was created while signed out — by you, or by someone
            else using this browser. Cloud sync is paused until you choose what to do with it.
          </DialogDescription>
        </DialogHeader>
        <ul className="text-sm text-sub space-y-1.5 list-disc pl-5">
          <li>
            <span className="text-text font-medium">Merge</span> adds it to your cloud workspace.
          </li>
          <li>
            <span className="text-text font-medium">Discard</span> removes all tools data stored in
            this browser, including changes made since you signed in. Your cloud workspace is not
            affected.
          </li>
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onDiscard} disabled={discarding} className="gap-1.5">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {discarding ? "Discarding…" : "Discard it"}
          </Button>
          <Button onClick={mergeVisitorData} disabled={discarding} className="gap-1.5">
            <CloudUpload className="w-4 h-4" aria-hidden="true" />
            Merge into my workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
