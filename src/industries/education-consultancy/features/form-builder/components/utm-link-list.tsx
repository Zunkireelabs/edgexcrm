"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { UtmLink } from "@/types/database";

export interface UtmLinkListHandle {
  addLink: (link: UtmLink) => void;
}

interface UtmLinkListProps {
  initialLinks: UtmLink[];
}

export const UtmLinkList = forwardRef<UtmLinkListHandle, UtmLinkListProps>(
  function UtmLinkList({ initialLinks }, ref) {
    const [links, setLinks] = useState<UtmLink[]>(initialLinks);
    const [pendingDelete, setPendingDelete] = useState<UtmLink | null>(null);
    const [deleting, setDeleting] = useState(false);

    useImperativeHandle(ref, () => ({
      addLink(link) {
        setLinks((prev) => [link, ...prev]);
      },
    }));

    async function handleConfirmDelete() {
      if (!pendingDelete || deleting) return;
      setDeleting(true);
      try {
        const res = await fetch(`/api/v1/utm-links/${pendingDelete.id}`, {
          method: "DELETE",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message || "Failed to delete link");
        }
        setLinks((prev) => prev.filter((l) => l.id !== pendingDelete.id));
        toast.success("Link deleted");
        setPendingDelete(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete link");
      } finally {
        setDeleting(false);
      }
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved tracking links</CardTitle>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No saved links yet. Build a link above and click <span className="font-medium">Save link</span> to remember it.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Medium</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell title={link.tracking_url} className="max-w-[200px]">
                      <div className="font-medium truncate">
                        {link.form_name ?? (
                          <span className="text-muted-foreground italic">External URL</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {link.destination_url}
                      </div>
                    </TableCell>
                    <TableCell>{link.utm_source ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{link.utm_medium ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{link.utm_campaign ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatRelativeTime(link.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CopyButton value={link.tracking_url} label="Tracking link" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(link)}
                          aria-label="Delete link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this tracking link?</DialogTitle>
              <DialogDescription>
                The saved entry will be removed from your list. Any links you&apos;ve already shared in ads or emails will keep working — they just won&apos;t be tracked here.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }
);
