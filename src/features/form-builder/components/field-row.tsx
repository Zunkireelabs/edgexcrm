"use client";

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
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
  ChevronRight,
} from "lucide-react";
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

const FIELD_META: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  text:          { icon: Type,        color: "text-blue-600",   bg: "bg-blue-50",    label: "Text" },
  email:         { icon: Mail,        color: "text-purple-600", bg: "bg-purple-50",  label: "Email" },
  tel:           { icon: Phone,       color: "text-green-600",  bg: "bg-green-50",   label: "Phone Number" },
  number:        { icon: Hash,        color: "text-cyan-600",   bg: "bg-cyan-50",    label: "Number" },
  date:          { icon: Calendar,    color: "text-teal-600",   bg: "bg-teal-50",    label: "Date" },
  textarea:      { icon: AlignLeft,   color: "text-indigo-600", bg: "bg-indigo-50",  label: "Text Area" },
  select:        { icon: ChevronDown, color: "text-orange-600", bg: "bg-orange-50",  label: "Dropdown" },
  radio:         { icon: CircleDot,   color: "text-rose-600",   bg: "bg-rose-50",    label: "Radio" },
  checkbox:      { icon: CheckSquare, color: "text-pink-600",   bg: "bg-pink-50",    label: "Checkbox" },
  file:          { icon: Paperclip,   color: "text-amber-600",  bg: "bg-amber-50",   label: "File" },
  entity_select: { icon: ListFilter,  color: "text-violet-600", bg: "bg-violet-50",  label: "Entity" },
};

const DEFAULT_META = { icon: Type, color: "text-gray-600", bg: "bg-gray-50", label: "Field" };

export function FieldRow({
  field,
  fieldId,
  onEdit,
  onRemove,
  onUpdateLabel,
}: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(field.label);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEditLabel(field.label), [field.label]);

  const meta = FIELD_META[field.type] ?? DEFAULT_META;
  const Icon = meta.icon;

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
      className={`flex items-center gap-3 px-3 py-3 rounded-xl border bg-white hover:shadow-sm group transition-all cursor-pointer ${
        isDragging ? "shadow-lg ring-2 ring-primary/20 border-primary/30" : "border-gray-100 hover:border-gray-200"
      }`}
      onClick={onEdit}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-0.5 text-gray-300 hover:text-gray-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Field type icon with colored background */}
      <div className={`w-8 h-8 rounded-lg ${meta.bg} ${meta.color} flex items-center justify-center shrink-0`}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Field info */}
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
            className="h-7 text-sm font-semibold px-1.5"
            autoFocus
          />
        ) : (
          <>
            <span
              className="text-sm font-semibold text-gray-900 truncate block"
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (onUpdateLabel) { setEditLabel(field.label); setEditing(true); }
              }}
            >
              {field.label}
            </span>
            <span className="text-[11px] text-gray-400">{meta.label}</span>
          </>
        )}
      </div>

      {/* Required badge */}
      {field.required && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">
          Required
        </span>
      )}

      {/* Delete — visible on hover */}
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-300 hover:text-red-500 rounded"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label="Remove field"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* Edit arrow */}
      <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
    </div>
  );
}
