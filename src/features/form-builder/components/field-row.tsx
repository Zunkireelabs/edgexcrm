"use client";

import { useState, useEffect } from "react";
import {
  GripVertical,
  Pencil,
  Trash2,
  Type,
  Mail,
  Phone,
  Hash,
  Calendar,
  AlignLeft,
  ChevronDown,
  CheckSquare,
  CircleDot,
  Paperclip,
  ListFilter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const FIELD_ICONS: Record<string, React.ElementType> = {
  text: Type,
  email: Mail,
  tel: Phone,
  number: Hash,
  date: Calendar,
  textarea: AlignLeft,
  select: ChevronDown,
  radio: CircleDot,
  checkbox: CheckSquare,
  file: Paperclip,
  entity_select: ListFilter,
};

export function FieldRow({
  field,
  fieldIndex,
  totalFields,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdateLabel,
}: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(field.label);

  useEffect(() => setEditLabel(field.label), [field.label]);

  const Icon = FIELD_ICONS[field.type] ?? Type;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-background hover:bg-muted/30 group cursor-pointer transition-colors"
      onClick={onEdit}
    >
      {/* Drag handle / field icon */}
      <div className="shrink-0 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>

      {/* Field label */}
      <div className="flex-1 min-w-0">
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
            onClick={(e) => e.stopPropagation()}
            className="h-7 text-sm font-medium px-1.5"
            autoFocus
          />
        ) : (
          <span
            className="text-sm font-medium truncate block"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (onUpdateLabel) { setEditLabel(field.label); setEditing(true); }
            }}
          >
            {field.label}
          </span>
        )}
      </div>

      {/* Required indicator */}
      {field.required && (
        <span className="text-xs text-red-400 shrink-0">Required</span>
      )}

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          aria-label="Edit field"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove field"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
