"use client";

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  fieldId: string;
  fieldIndex: number;
  stepIndex: number;
  totalFields: number;
  onEdit: () => void;
  onRemove: () => void;
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
  fieldId,
  fieldIndex,
  totalFields,
  onEdit,
  onRemove,
  onUpdateLabel,
}: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(field.label);

  useEffect(() => setEditLabel(field.label), [field.label]);

  const Icon = FIELD_ICONS[field.type] ?? Type;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-2.5 rounded-lg border bg-background hover:bg-muted/30 group transition-colors ${
        isDragging ? "shadow-lg ring-2 ring-primary/20" : ""
      }`}
      onClick={onEdit}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground hover:text-foreground shrink-0"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Field icon */}
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
