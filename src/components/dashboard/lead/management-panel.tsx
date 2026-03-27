"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CheckSquare, Square, Plus, Trash2, FileDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { Lead, LeadChecklist } from "@/types/database";

interface ManagementPanelProps {
  lead: Lead;
  checklists: LeadChecklist[];
  isAdmin: boolean;
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
  onChecklistsChange: (checklists: LeadChecklist[]) => void;
}

const ChecklistCard = forwardRef<HTMLInputElement, ChecklistCardProps>(
  function ChecklistCard({ leadId, checklists, isAdmin, onChecklistsChange }, ref) {
    const [newTitle, setNewTitle] = useState("");
    const [adding, setAdding] = useState(false);

    const completedCount = checklists.filter((c) => c.is_completed).length;

    const handleAdd = async () => {
      if (!newTitle.trim()) return;
      setAdding(true);

      try {
        const res = await fetch(`/api/v1/leads/${leadId}/checklists`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        onChecklistsChange([...checklists, json.data as LeadChecklist]);
        setNewTitle("");
        toast.success("Task added");
      } catch {
        toast.error("Failed to add task");
      } finally {
        setAdding(false);
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
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleDelete(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}

          {checklists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No tasks yet
            </p>
          )}

          {isAdmin && (
            <div className="flex gap-2 pt-2">
              <Input
                ref={ref}
                placeholder="Add task..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="text-sm h-8"
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
