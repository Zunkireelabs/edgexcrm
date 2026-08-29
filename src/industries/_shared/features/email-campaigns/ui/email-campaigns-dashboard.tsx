"use client";

// /email-campaigns — recent blasts + New blast button. Mirrors sms/ui/sms-dashboard.tsx
// minus the credits/settings/suppressions tabs (no credit ledger for email;
// suppressions and settings already exist elsewhere — email_suppressions has
// no dedicated UI yet, out of this phase's scope). Owns the only "New blast"
// entry point: POST /email-blasts creates the draft, then routes to
// /email-campaigns/[id] where blast-composer takes over.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Mail, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { emailBlastGet, emailBlastSend, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastRow, EmailBlastStatus } from "../lib/types";

interface EmailCampaignsDashboardProps {
  canSendEmail: boolean;
}

const STATUS_DOT: Record<EmailBlastStatus, { dot: string; pill: string }> = {
  draft: { dot: "bg-gray-400", pill: "bg-gray-100 text-gray-500" },
  scheduled: { dot: "bg-blue-500", pill: "bg-blue-50 text-blue-700" },
  queued: { dot: "bg-blue-500", pill: "bg-blue-50 text-blue-700" },
  sending: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700" },
  throttled: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700" },
  sent: { dot: "bg-green-500", pill: "bg-green-50 text-green-700" },
  partially_failed: { dot: "bg-red-500", pill: "bg-red-50 text-red-700" },
  failed: { dot: "bg-red-500", pill: "bg-red-50 text-red-700" },
  cancelled: { dot: "bg-gray-400", pill: "bg-gray-100 text-gray-500" },
};

export function EmailCampaignsDashboard({ canSendEmail }: EmailCampaignsDashboardProps) {
  const router = useRouter();
  const [blasts, setBlasts] = useState<EmailBlastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; blast: EmailBlastRow | null }>({
    open: false,
    blast: null,
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; blast: EmailBlastRow | null; value: string }>({
    open: false,
    blast: null,
    value: "",
  });

  useEffect(() => {
    emailBlastGet<EmailBlastRow[]>("/api/v1/email-blasts?page=1&pageSize=20")
      .then(({ data }) => setBlasts(data))
      .catch((e: EmailBlastApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleNewBlast() {
    setCreatingDraft(true);
    try {
      const draft = await emailBlastSend<EmailBlastRow>("/api/v1/email-blasts", "POST", {
        name: "Untitled blast",
        subject_template: " ",
        body_template: " ",
      });
      router.push(`/email-campaigns/${draft.id}`);
    } catch (e) {
      toast.error(e instanceof EmailBlastApiError ? e.message : "Failed to create draft blast.");
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleDelete(blast: EmailBlastRow) {
    setDeletingId(blast.id);
    try {
      await emailBlastSend(`/api/v1/email-blasts/${blast.id}`, "DELETE");
      setBlasts((prev) => prev.filter((b) => b.id !== blast.id));
      toast.success("Blast deleted");
    } catch (e) {
      toast.error(e instanceof EmailBlastApiError ? e.message : "Failed to delete blast.");
    } finally {
      setDeletingId(null);
      setDeleteDialog({ open: false, blast: null });
    }
  }

  async function handleRename(blast: EmailBlastRow, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setRenamingId(blast.id);
    try {
      await emailBlastSend(`/api/v1/email-blasts/${blast.id}`, "PATCH", { name: trimmed });
      setBlasts((prev) => prev.map((b) => (b.id === blast.id ? { ...b, name: trimmed } : b)));
      toast.success("Blast renamed");
    } catch (e) {
      toast.error(e instanceof EmailBlastApiError ? e.message : "Failed to rename blast.");
    } finally {
      setRenamingId(null);
      setRenameDialog({ open: false, blast: null, value: "" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">One-shot email blasts to your leads.</p>
        </div>
        {canSendEmail && (
          <Button onClick={handleNewBlast} disabled={creatingDraft}>
            <Plus className="h-4 w-4" />
            New blast
          </Button>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading blasts…</div>
      ) : blasts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <Mail className="h-8 w-8 opacity-40" />
          <p className="text-sm">No blasts yet.</p>
        </div>
      ) : (
        <div className="border rounded-xl divide-y bg-card overflow-hidden">
          {blasts.map((b) => {
            const status = STATUS_DOT[b.status];
            return (
              <div
                key={b.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center bg-primary/10">
                  <Mail className="h-4 w-4 text-primary" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm truncate">{b.name}</h3>
                    <span
                      className={`shrink-0 flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${status.pill}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                      {b.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {b.recipients_total > 0 ? `${b.recipients_total} recipients` : "No recipients yet"} · Updated{" "}
                    {new Date(b.updated_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/email-campaigns/${b.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit blast
                    </Link>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={deletingId === b.id}>
                        {deletingId === b.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {b.status === "draft" && (
                        <DropdownMenuItem
                          onClick={() => setRenameDialog({ open: true, blast: b, value: b.name })}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-2" />
                          Rename
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteDialog({ open: true, blast: b })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && setDeleteDialog({ open: false, blast: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Blast</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.blast?.name}&quot;? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, blast: null })}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingId === deleteDialog.blast?.id}
              onClick={() => deleteDialog.blast && handleDelete(deleteDialog.blast)}
            >
              {deletingId === deleteDialog.blast?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameDialog.open}
        onOpenChange={(open) => !open && setRenameDialog({ open: false, blast: null, value: "" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Blast</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDialog.value}
            onChange={(e) => setRenameDialog((prev) => ({ ...prev, value: e.target.value }))}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialog({ open: false, blast: null, value: "" })}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !renameDialog.value.trim() || renamingId === renameDialog.blast?.id
              }
              onClick={() => renameDialog.blast && handleRename(renameDialog.blast, renameDialog.value)}
            >
              {renamingId === renameDialog.blast?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
