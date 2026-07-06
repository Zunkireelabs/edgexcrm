"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CheckSquare, Square, Plus, Trash2, FileDown, ExternalLink, AlarmClock, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { Lead, LeadChecklist } from "@/types/database";

// Reminder presets → ISO timestamp (computed at click time).
function reminderPresets(): { label: string; iso: string }[] {
  const now = new Date();
  const plus = (h: number) => new Date(now.getTime() + h * 3600 * 1000).toISOString();
  const at9 = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  return [
    { label: "In 1 hour", iso: plus(1) },
    { label: "In 3 hours", iso: plus(3) },
    { label: "Tomorrow 9 AM", iso: at9(1) },
    { label: "Next week", iso: at9(7) },
  ];
}

function formatRemind(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReminderButton({
  value,
  onPick,
  onClear,
  onCustom,
}: {
  value: string | null;
  onPick: (iso: string) => void;
  onClear: () => void;
  onCustom?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          title={value ? `Reminder: ${formatRemind(value)}` : "Set reminder"}
        >
          <AlarmClock className={`h-4 w-4 ${value ? "text-primary" : ""}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {reminderPresets().map((p) => (
          <DropdownMenuItem key={p.label} onClick={() => onPick(p.iso)}>
            {p.label}
          </DropdownMenuItem>
        ))}
        {onCustom && (
          <DropdownMenuItem onClick={onCustom}>Custom…</DropdownMenuItem>
        )}
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClear} className="text-destructive">
              Clear reminder
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ManagementPanelProps {
  lead: Lead;
  checklists: LeadChecklist[];
  isAdmin: boolean;
  canEdit?: boolean;
  onChecklistsChange: (checklists: LeadChecklist[]) => void;
}

export interface ManagementPanelRef {
  focusInput: () => void;
}

export const ManagementPanel = forwardRef<ManagementPanelRef, ManagementPanelProps>(
  function ManagementPanel(
    {
      lead,
      checklists,
      isAdmin,
      canEdit,
      onChecklistsChange,
    },
    ref
  ) {
    const checklistInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focusInput: () => {
        checklistInputRef.current?.focus();
      },
    }));

    const fileUrls = lead.file_urls || {};
    const documents = Object.entries(fileUrls);

    return (
      <div className="space-y-4">
        {/* Checklist */}
        <ChecklistCard
          ref={checklistInputRef}
          leadId={lead.id}
          checklists={checklists}
          isAdmin={isAdmin}
          canEdit={canEdit}
          onChecklistsChange={onChecklistsChange}
        />

        {/* Documents */}
        {documents.length > 0 && (
          <Card className="shadow-none rounded-lg py-0">
            <CardHeader className="pt-4 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Documents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              {documents.map(([key, url]) => (
                <DocumentRow key={key} name={key} url={url} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }
);

// Checklist Card Component
interface ChecklistCardProps {
  leadId: string;
  checklists: LeadChecklist[];
  isAdmin: boolean;
  canEdit?: boolean;
  onChecklistsChange: (checklists: LeadChecklist[]) => void;
}

export const ChecklistCard = forwardRef<HTMLInputElement, ChecklistCardProps>(
  function ChecklistCard({ leadId, checklists, isAdmin, canEdit = false, onChecklistsChange }, ref) {
    // Admins, plus members whose position grants canEditLeads, can add/manage tasks.
    const canManageTasks = isAdmin || canEdit;
    const [newTitle, setNewTitle] = useState("");
    const [adding, setAdding] = useState(false);
    const [remindAt, setRemindAt] = useState<string | null>(null);
    const [showCustom, setShowCustom] = useState(false);

    const completedCount = checklists.filter((c) => c.is_completed).length;

    const handleAdd = async () => {
      if (!newTitle.trim()) return;
      setAdding(true);

      try {
        const res = await fetch(`/api/v1/leads/${leadId}/checklists`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle.trim(), remind_at: remindAt }),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        onChecklistsChange([...checklists, json.data as LeadChecklist]);
        setNewTitle("");
        setRemindAt(null);
        setShowCustom(false);
        toast.success(remindAt ? "Task added with reminder" : "Task added");
      } catch {
        toast.error("Failed to add task");
      } finally {
        setAdding(false);
      }
    };

    const handleSetReminder = async (item: LeadChecklist, iso: string | null) => {
      const prev = item.remind_at;
      onChecklistsChange(
        checklists.map((c) => (c.id === item.id ? { ...c, remind_at: iso } : c))
      );
      try {
        const res = await fetch(`/api/v1/leads/${leadId}/checklists/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remind_at: iso }),
        });
        if (!res.ok) throw new Error();
        toast.success(iso ? "Reminder set" : "Reminder cleared");
      } catch {
        onChecklistsChange(
          checklists.map((c) => (c.id === item.id ? { ...c, remind_at: prev } : c))
        );
        toast.error("Failed to update reminder");
      }
    };

    const handleToggle = async (item: LeadChecklist) => {
      const newCompleted = !item.is_completed;
      // Optimistic update
      onChecklistsChange(
        checklists.map((c) =>
          c.id === item.id ? { ...c, is_completed: newCompleted } : c
        )
      );

      try {
        const res = await fetch(`/api/v1/leads/${leadId}/checklists/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_completed: newCompleted }),
        });
        if (!res.ok) throw new Error();
      } catch {
        // Revert
        onChecklistsChange(
          checklists.map((c) =>
            c.id === item.id ? { ...c, is_completed: item.is_completed } : c
          )
        );
        toast.error("Failed to update task");
      }
    };

    const handleDelete = async (itemId: string) => {
      onChecklistsChange(checklists.filter((c) => c.id !== itemId));

      try {
        const res = await fetch(`/api/v1/leads/${leadId}/checklists/${itemId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Failed to delete task");
        // Re-fetch
        try {
          const res = await fetch(`/api/v1/leads/${leadId}/checklists`);
          if (res.ok) {
            const json = await res.json();
            onChecklistsChange(json.data || []);
          }
        } catch {
          // ignore
        }
      }
    };

    return (
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Checklist
            </CardTitle>
            {checklists.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {completedCount}/{checklists.length}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          {checklists.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between group py-1"
            >
              <button
                type="button"
                className="flex items-center gap-2 text-sm hover:text-foreground transition-colors text-left flex-1 min-w-0"
                onClick={() => handleToggle(item)}
              >
                {item.is_completed ? (
                  <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span
                  className={
                    item.is_completed
                      ? "line-through text-muted-foreground truncate"
                      : "truncate"
                  }
                >
                  {item.title}
                </span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {item.remind_at && !item.is_completed && (
                  <span
                    className="flex items-center gap-1 text-[11px] text-primary whitespace-nowrap"
                    title={`Reminder: ${formatRemind(item.remind_at)}`}
                  >
                    <AlarmClock className="h-3 w-3" />
                    {formatRemind(item.remind_at)}
                  </span>
                )}
                {canManageTasks && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <ReminderButton
                      value={item.remind_at}
                      onPick={(iso) => handleSetReminder(item, iso)}
                      onClear={() => handleSetReminder(item, null)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {checklists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No tasks yet
            </p>
          )}

          {canManageTasks && (
            <div className="space-y-2 pt-2">
              <div className="flex gap-2">
                <Input
                  ref={ref}
                  placeholder="Add task..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  className="text-sm h-8"
                />
                <ReminderButton
                  value={remindAt}
                  onPick={(iso) => { setRemindAt(iso); setShowCustom(false); }}
                  onClear={() => setRemindAt(null)}
                  onCustom={() => setShowCustom(true)}
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={handleAdd}
                  disabled={adding || !newTitle.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {showCustom && (
                <input
                  type="datetime-local"
                  className="text-xs border rounded px-2 py-1 w-full"
                  onChange={(e) => {
                    if (e.target.value) {
                      setRemindAt(new Date(e.target.value).toISOString());
                      setShowCustom(false);
                    }
                  }}
                />
              )}
              {remindAt && (
                <div className="flex items-center gap-1 text-xs text-primary">
                  <AlarmClock className="h-3 w-3" />
                  Reminder: {formatRemind(remindAt)}
                  <button
                    type="button"
                    onClick={() => setRemindAt(null)}
                    className="ml-1 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);

// Document Row Component
function DocumentRow({ name, url }: { name: string; url: string }) {
  const displayName = name.replace(/_/g, " ");

  return (
    <div className="flex items-center justify-between py-1.5 group">
      <div className="flex items-center gap-2 min-w-0">
        <FileDown className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm capitalize truncate">{displayName}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          asChild
        >
          <a href={url} download target="_blank" rel="noopener noreferrer">
            <FileDown className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          asChild
        >
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}
