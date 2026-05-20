"use client";

import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { FormField } from "@/types/database";

interface FieldRowProps {
  field: FormField;
  fieldIndex: number;
  stepIndex: number;
  totalFields: number;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdateLabel?: (newLabel: string) => void;
}

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-100 text-blue-700",
  email: "bg-purple-100 text-purple-700",
  tel: "bg-green-100 text-green-700",
  select: "bg-orange-100 text-orange-700",
  file: "bg-yellow-100 text-yellow-700",
  textarea: "bg-indigo-100 text-indigo-700",
  checkbox: "bg-pink-100 text-pink-700",
  radio: "bg-red-100 text-red-700",
  date: "bg-teal-100 text-teal-700",
  number: "bg-cyan-100 text-cyan-700",
  entity_select: "bg-violet-100 text-violet-700",
};

export function FieldRow({
  field,
  fieldIndex,
  stepIndex,
  totalFields,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdateLabel,
}: FieldRowProps) {
  const colorClass = FIELD_TYPE_COLORS[field.type] ?? "bg-gray-100 text-gray-700";
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(field.label);

  useEffect(() => setEditLabel(field.label), [field.label]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-background hover:bg-muted/40 group">
      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
          onClick={onMoveUp}
          disabled={fieldIndex === 0}
          aria-label="Move field up"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
          onClick={onMoveDown}
          disabled={fieldIndex === totalFields - 1}
          aria-label="Move field down"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Field info */}
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        {editing ? (
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={() => {
              if (editLabel.trim() && onUpdateLabel) onUpdateLabel(editLabel.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { setEditLabel(field.label); setEditing(false); }
            }}
            className="h-6 text-sm font-medium px-1 w-40"
            autoFocus
          />
        ) : (
          <span
            className="text-sm font-medium truncate cursor-text"
            onDoubleClick={() => { if (onUpdateLabel) { setEditLabel(field.label); setEditing(true); } }}
            title="Double-click to rename"
          >
            {field.label}
          </span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
          {field.type}
        </span>
        {field.required && (
          <span className="text-xs text-destructive font-semibold">*required</span>
        )}
        {field.width && field.width !== "full" && (
          <span className="text-xs text-muted-foreground">{field.width}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit field">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove field"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
