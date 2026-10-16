"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useHistory } from "@/lib/history/use-history";

interface ToolHistoryDrawerProps {
  toolId: string;
}

/**
 * The drawer body (event grouping, time-travel restore, all the
 * lucide icons + ScrollArea machinery) is `next/dynamic`-loaded — most
 * users open this drawer rarely, so deferring its bundle saves a few KB
 * of first-paint JS for every tool that wraps in <ToolPageWrapper>.
 *
 * The trigger button still pulls `useHistory` so the badge count is
 * accurate from first paint; the hook is small and mostly shared.
 */
const ToolHistoryDrawerContent = dynamic(() => import("./tool-history-drawer-content"), {
  ssr: false,
});

export function ToolHistoryDrawer({ toolId }: ToolHistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const { total } = useHistory({ toolId, limit: 1 });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label={`Open history for this tool (${total} events)`}
        >
          <History className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">History</span>
          {total > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 h-4 text-xs">
              {total > 999 ? "999+" : total}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      {open && <ToolHistoryDrawerContent toolId={toolId} onClose={() => setOpen(false)} />}
    </Sheet>
  );
}
