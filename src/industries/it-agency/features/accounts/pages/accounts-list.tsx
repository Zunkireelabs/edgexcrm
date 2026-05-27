"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Building2, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountForm } from "../components/account-form";
import type { Account } from "@/types/database";

interface AccountWithCount extends Account {
  project_count: number;
}

interface AccountsListPageProps {
  tenantId: string;
  role: string;
}

export function AccountsListPage({ role }: AccountsListPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const [accounts, setAccounts] = useState<AccountWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then(({ data }) => setAccounts(data ?? []))
      .catch(() => toast.error("Failed to load accounts"))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(account: Account) {
    setAccounts((prev) => [{ ...account, project_count: 0 }, ...prev]);
  }

  function handleUpdated(account: Account) {
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id ? { ...account, project_count: a.project_count } : a
      )
    );
  }

  async function handleDelete(account: Account) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      toast.success("Account deleted");
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Companies and clients your team works with
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Button>
        )}
      </div>

      {/* Empty state */}
      {accounts.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-background">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No accounts yet</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Add your first client account to start tracking projects and time.
          </p>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first account
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card
              key={account.id}
              className="border shadow-none hover:shadow-sm transition-shadow"
            >
              <CardContent className="p-0">
                <div className="flex items-center gap-4 p-4">
                  {/* Active indicator */}
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      account.is_active ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/accounts/${account.id}`}
                      className="font-medium text-sm hover:underline truncate block"
                    >
                      {account.name}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {account.primary_contact_email
                        ? `${account.primary_contact_email} · `
                        : ""}
                      {account.project_count}{" "}
                      {account.project_count === 1 ? "project" : "projects"}
                      {!account.is_active && " · Inactive"}
                    </p>
                  </div>
                  {/* Admin actions */}
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditTarget(account)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(account)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <AccountForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreated}
      />

      {/* Edit dialog */}
      {editTarget && (
        <AccountForm
          account={editTarget}
          open={Boolean(editTarget)}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSuccess={handleUpdated}
        />
      )}

      {/* Delete confirmation */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? All associated
              projects and tasks will also be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
