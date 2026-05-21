"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  GraduationCap,
  BookOpen,
  CalendarClock,
  MessageSquare,
  Plus,
  Loader2,
  Layers,
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EDUCATION_CONSULTANCY_TEMPLATES, BLANK_TEMPLATE } from "../templates";
import type { TemplateDefinition } from "../types";

const ICON_MAP: Record<string, React.ElementType> = {
  GraduationCap,
  BookOpen,
  CalendarClock,
  MessageSquare,
  Plus,
};

function TemplateIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] ?? Layers;
  return <Icon className="h-6 w-6" />;
}

interface TemplatePickerProps {
  onSelect?: (template: TemplateDefinition) => void;
  selectedId?: string | null;
}

export function TemplatePicker({ onSelect, selectedId }: TemplatePickerProps = {}) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);

  async function handleSelect(template: TemplateDefinition) {
    // If external handler provided (wizard mode), delegate to it
    if (onSelect) {
      onSelect(template);
      return;
    }

    // Default behavior: create form immediately
    setCreating(template.id);
    try {
      const res = await fetch("/api/v1/form-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          template_id: template.id === "blank" ? undefined : template.id,
          is_multi_step: template.isMultiStep,
        }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create form");
      }

      const { data } = await res.json();
      toast.success("Form created");
      router.push(`/forms/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create form");
      setCreating(null);
    }
  }

  const allTemplates = [...EDUCATION_CONSULTANCY_TEMPLATES, BLANK_TEMPLATE];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create New Form</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Choose a template to get started quickly, or build from scratch.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {allTemplates.map((template) => {
          const isLoading = creating === template.id;
          const isBlank = template.id === "blank";

          return (
            <Card
              key={template.id}
              className={`cursor-pointer transition-all hover:border-primary hover:shadow-sm ${
                isBlank ? "border-dashed" : ""
              } ${isLoading ? "opacity-70 pointer-events-none" : ""} ${
                selectedId === template.id ? "border-primary ring-2 ring-primary/20" : ""
              }`}
              onClick={() => !creating && handleSelect(template)}
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div
                    className={`p-2 rounded-lg ${
                      isBlank
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <TemplateIcon name={template.icon} />
                    )}
                  </div>
                  {template.isMultiStep && !isBlank && (
                    <Badge variant="secondary" className="text-xs">
                      Multi-step
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <CardDescription className="text-xs mt-1">
                  {template.description}
                </CardDescription>
                {!isBlank && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {template.steps.length} {template.steps.length === 1 ? "step" : "steps"},{" "}
                    {template.steps.reduce((acc, s) => acc + s.fields.length, 0)} fields
                  </p>
                )}
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
