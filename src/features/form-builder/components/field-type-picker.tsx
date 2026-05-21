"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FormField } from "@/types/database";
import { toFieldName } from "../lib/validation";

type FieldType = FormField["type"];

const FIELD_TYPES: { type: FieldType; label: string; description: string }[] = [
  { type: "text", label: "Text", description: "Short single-line text" },
  { type: "email", label: "Email", description: "Email address with validation" },
  { type: "tel", label: "Phone", description: "Phone number input" },
  { type: "number", label: "Number", description: "Numeric input" },
  { type: "date", label: "Date", description: "Date picker" },
  { type: "textarea", label: "Textarea", description: "Multi-line text" },
  { type: "select", label: "Dropdown", description: "Select from a list" },
  { type: "radio", label: "Radio", description: "Single choice from options" },
  { type: "checkbox", label: "Checkbox", description: "Single checkbox / agreement" },
  { type: "file", label: "File Upload", description: "Upload documents or images" },
  { type: "entity_select", label: "Entity Select", description: "Select from partner colleges / entities" },
];

interface FieldTypePickerProps {
  onSelect: (field: FormField) => void;
}

function buildDefaultField(type: FieldType, label: string): FormField {
  const base: FormField = {
    name: toFieldName(label) || type,
    label,
    type,
    required: false,
  };

  if (type === "select" || type === "radio") {
    base.options = [
      { label: "Option 1", value: "option_1" },
      { label: "Option 2", value: "option_2" },
    ];
  }

  if (type === "file") {
    base.validation = { max_size_mb: 5, accepted_types: ["application/pdf", "image/jpeg", "image/png"] };
  }

  return base;
}

export function FieldTypePicker({ onSelect }: FieldTypePickerProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(type: FieldType, label: string) {
    onSelect(buildDefaultField(type, label));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full mt-2">
          <Plus className="h-4 w-4 mr-2" />
          Add Field
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" side="top">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1 mb-1">
          Choose field type
        </p>
        <div className="space-y-0.5">
          {FIELD_TYPES.map(({ type, label, description }) => (
            <button
              key={type}
              className="w-full flex items-start gap-3 px-2 py-2 rounded-md hover:bg-muted text-left"
              onClick={() => handleSelect(type, label)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
