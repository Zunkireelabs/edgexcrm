"use client";

import { useCallback, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { classifyApiError, type ApiErrorLike, type BlockingNotice } from "@/lib/blocking-notice";

/** The large "you're blocked — here is what to do" pop-up. Presentational; see useBlockingNotice(). */
export function BlockingNoticeDialog({
  notice,
  onClose,
}: {
  notice: BlockingNotice | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={notice !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader className="items-center text-center sm:items-start sm:text-left">
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <TriangleAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <AlertDialogTitle className="text-xl">{notice?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{notice?.message}</AlertDialogDescription>
        </AlertDialogHeader>

        {notice?.items && notice.items.length > 0 && (
          <ul className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="What needs attention">
            {notice.items.map((item) => (
              <li key={item.label} className="text-sm">
                <span className="font-semibold text-foreground">{item.label}</span>
                {item.hint && <span className="block text-muted-foreground">{item.hint}</span>}
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One helper for "show this server error properly".
 *
 *   const { notify, showNotice, noticeDialog } = useBlockingNotice();
 *   ...
 *   notify(json.error, "Failed to save");   // big pop-up for rule-blocking codes, toast otherwise
 *   ...
 *   return <>{...}{noticeDialog}</>;         // render the pop-up once per screen
 */
export function useBlockingNotice() {
  const [notice, setNotice] = useState<BlockingNotice | null>(null);

  const showNotice = useCallback((next: BlockingNotice) => setNotice(next), []);

  /** Returns true when a big pop-up was shown, false when it fell back to a normal toast. */
  const notify = useCallback((error: ApiErrorLike | null | undefined, fallbackMessage?: string): boolean => {
    const result = classifyApiError(error, fallbackMessage);
    if (result.kind === "blocking") {
      setNotice(result.notice);
      return true;
    }
    toast.error(result.message);
    return false;
  }, []);

  const noticeDialog = <BlockingNoticeDialog notice={notice} onClose={() => setNotice(null)} />;

  return { notify, showNotice, noticeDialog };
}
