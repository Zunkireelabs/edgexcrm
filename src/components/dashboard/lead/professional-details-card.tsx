"use client";

import { useState } from "react";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Standard professional fields for B2B leads
const PROFESSIONAL_FIELDS = [
  { key: "company", label: "Company" },
  { key: "designation", label: "Designation" },
  { key: "address", label: "Address" },
  { key: "office_phone", label: "Office Phone" },
] as const;

interface ProfessionalDetailsCardProps {
  leadId: string;
  customFields: Record<string, unknown>;
  onFieldsUpdate: (fields: Record<string, unknown>) => void;
  isAdmin: boolean;
}

export function ProfessionalDetailsCard({
  leadId,
  customFields,
  onFieldsUpdate,
  isAdmin,
}: ProfessionalDetailsCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // Get other custom fields that aren't in our standard professional fields
  const professionalFieldKeys: string[] = PROFESSIONAL_FIELDS.map((f) => f.key);
  const otherFields = Object.entries(customFields).filter(
    ([key, value]) => !professionalFieldKeys.includes(key) && value != null && value !== ""
  );

  // Check if any professional fields have values
  const hasProfessionalData = PROFESSIONAL_FIELDS.some(
    (f) => customFields[f.key] != null && customFields[f.key] !== ""
  );

  const startEditing = () => {
    // Initialize edit values with current values
    const initial: Record<string, string> = {};
    PROFESSIONAL_FIELDS.forEach((f) => {
      initial[f.key] = String(customFields[f.key] || "");
    });
    setEditValues(initial);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValues({});
  };

  const saveChanges = async () => {
    setIsSaving(true);
    try {
      // Merge edited professional fields with other custom fields
      const updatedCustomFields = { ...customFields };
      PROFESSIONAL_FIELDS.forEach((f) => {
        const value = editValues[f.key]?.trim();
        if (value) {
          updatedCustomFields[f.key] = value;
        } else {
          // Remove empty fields
          delete updatedCustomFields[f.key];
        }
      });

      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_fields: updatedCustomFields }),
      });

      if (!res.ok) throw new Error("Failed to update");

      onFieldsUpdate(updatedCustomFields);
      setIsEditing(false);
      toast.success("Details updated");
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardHeader className="pt-4 pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Professional Details</CardTitle>
        {isAdmin && !isEditing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={startEditing}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        )}
        {isEditing && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={cancelEditing}
              disabled={isSaving}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 px-2"
              onClick={saveChanges}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Save
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 pb-4">
        {isEditing ? (
          // Edit mode - show inputs for all standard fields
          PROFESSIONAL_FIELDS.map((field) => (
            <div key={field.key} className="grid grid-cols-[140px_1fr] gap-4 text-sm items-center">
              <span className="text-muted-foreground">{field.label}</span>
              <Input
                value={editValues[field.key] || ""}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="h-8 text-sm"
              />
            </div>
          ))
        ) : hasProfessionalData ? (
          // View mode with data
          PROFESSIONAL_FIELDS.map((field) => {
            const value = customFields[field.key];
            if (value == null || value === "") return null;
            return (
              <div key={field.key} className="grid grid-cols-[140px_1fr] gap-4 text-sm">
                <span className="text-muted-foreground">{field.label}</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            );
          })
        ) : (
          // Empty state
          <div className="text-sm text-muted-foreground py-2">
            No professional details added.{" "}
            {isAdmin && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={startEditing}
              >
                Add details
              </button>
            )}
          </div>
        )}

        {/* Other custom fields (non-professional, read-only) */}
        {!isEditing && otherFields.length > 0 && (
          <>
            {hasProfessionalData && <div className="border-t my-2" />}
            {otherFields.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[140px_1fr] gap-4 text-sm">
                <span className="text-muted-foreground">{formatFieldLabel(key)}</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
