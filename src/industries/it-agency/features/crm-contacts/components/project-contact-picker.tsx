"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProjectContactRole = "primary" | "technical" | "billing" | "other" | "";

interface ProjectRow {
  id: string;
  name: string;
  account_id: string;
  accounts?: { id: string; name: string } | null;
}

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  status: string;
  account_id: string;
  accounts?: { id: string; name: string } | null;
}

interface PickProjectResult {
  role: ProjectContactRole;
  projects: { id: string; name: string; account_id: string; accounts?: { id: string; name: string } | null } | null;
}

interface PickContactResult {
  role: ProjectContactRole;
  contacts: { id: string; first_name: string; last_name: string; email: string | null; title: string | null; status: string } | null;
}

interface PickProjectProps {
  mode: "pick-project";
  contactId: string;
  accountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (link: PickProjectResult) => void;
}

interface PickContactProps {
  mode: "pick-contact";
  projectId: string;
  accountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (link: PickContactResult) => void;
}

type ProjectContactPickerProps = PickProjectProps | PickContactProps;

const NO_ROLE = "__none__";

const ROLE_OPTIONS = [
  { value: NO_ROLE, label: "No role" },
  { value: "primary", label: "Primary" },
  { value: "technical", label: "Technical" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

export function ProjectContactPicker(props: ProjectContactPickerProps) {
  const { mode, accountId, open, onOpenChange } = props;

  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [role, setRole] = useState<string>(NO_ROLE);
  const [saving, setSaving] = useState(false);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");

  function resetState() {
    setSearch("");
    setShowAll(false);
    setRole(NO_ROLE);
    setSelectedProjectId("");
    setSelectedContactId("");
    setProjects([]);
    setContacts([]);
  }

  function handleOpenChange(next: boolean) {
    if (next) resetState();
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    if (mode === "pick-project") {
      const url = showAll || !accountId
        ? "/api/v1/projects"
        : `/api/v1/projects?account_id=${accountId}`;
      fetch(url)
        .then((r) => r.json())
        .then(({ data }) => setProjects(data ?? []))
        .catch(() => toast.error("Failed to load projects"))
        .finally(() => setLoading(false));
    } else {
      const url = showAll || !accountId
        ? "/api/v1/contacts?include_inactive=1"
        : `/api/v1/contacts?account_id=${accountId}&include_inactive=1`;
      fetch(url)
        .then((r) => r.json())
        .then(({ data }) => setContacts(data ?? []))
        .catch(() => toast.error("Failed to load contacts"))
        .finally(() => setLoading(false));
    }
  }, [open, mode, accountId, showAll]);

  const filteredProjects = projects.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.accounts?.name ?? "").toLowerCase().includes(q)
    );
  });

  const filteredContacts = contacts.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    return (
      fullName.includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.title ?? "").toLowerCase().includes(q) ||
      (c.accounts?.name ?? "").toLowerCase().includes(q)
    );
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "pick-project" && !selectedProjectId) return;
    if (mode === "pick-contact" && !selectedContactId) return;

    setSaving(true);
    try {
      if (mode === "pick-project") {
        const { contactId } = props as PickProjectProps;
        const res = await fetch(`/api/v1/contacts/${contactId}/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: selectedProjectId,
            role: role === NO_ROLE ? undefined : role,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          const msg = json.error?.message ?? "Failed to link project";
          toast.error(msg);
          return;
        }
        toast.success("Project linked");
        (props as PickProjectProps).onSuccess(json.data as PickProjectResult);
        onOpenChange(false);
      } else {
        const { projectId } = props as PickContactProps;
        const res = await fetch(`/api/v1/projects/${projectId}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: selectedContactId,
            role: role === NO_ROLE ? undefined : role,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          const msg = json.error?.message ?? "Failed to link contact";
          toast.error(msg);
          return;
        }
        toast.success("Contact linked");
        (props as PickContactProps).onSuccess(json.data as PickContactResult);
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    mode === "pick-project" ? Boolean(selectedProjectId) : Boolean(selectedContactId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "pick-project" ? "Add to Project" : "Add Contact"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={mode === "pick-project" ? "Search projects…" : "Search contacts…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Show-all toggle */}
          {accountId && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setShowAll((v) => !v);
                setSearch("");
                setSelectedProjectId("");
                setSelectedContactId("");
              }}
            >
              {showAll
                ? mode === "pick-project"
                  ? "Show only this account's projects"
                  : "Show only this account's contacts"
                : mode === "pick-project"
                  ? "Show all accounts' projects"
                  : "Show all accounts' contacts"}
            </button>
          )}

          {/* List */}
          <div className="border rounded-md max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : mode === "pick-project" ? (
              filteredProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No projects found.
                </p>
              ) : (
                filteredProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                      selectedProjectId === p.id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <span>{p.name}</span>
                    {p.accounts?.name && (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        at {p.accounts.name}
                      </span>
                    )}
                  </button>
                ))
              )
            ) : filteredContacts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No contacts found.
              </p>
            ) : (
              filteredContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedContactId(c.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    selectedContactId === c.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  <span>
                    {c.first_name} {c.last_name}
                  </span>
                  {c.title && (
                    <span className="text-muted-foreground ml-1.5 text-xs">{c.title}</span>
                  )}
                  {c.accounts?.name && (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      · {c.accounts.name}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ProjectContactRole)}>
              <SelectTrigger>
                <SelectValue placeholder="No role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
