"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Rocket, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { TemplatePicker } from "./template-picker";
import type { TemplateDefinition } from "../types";

interface FormCreationWizardProps {
  tenantPrimaryColor: string;
  tenantSlug: string;
  industryId?: string | null;
}

export function FormCreationWizard({ tenantPrimaryColor, tenantSlug, industryId }: FormCreationWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition | null>(null);
  const [formName, setFormName] = useState("");
  const [primaryColor, setPrimaryColor] = useState(tenantPrimaryColor || "#6366f1");
  const [buttonText, setButtonText] = useState("Submit");
  const [creating, setCreating] = useState(false);

  function handleTemplateSelect(template: TemplateDefinition) {
    setSelectedTemplate(template);
    setFormName(template.branding?.title || template.name);
    setButtonText(template.branding?.button_text || "Submit");
    setStep(2);
  }

  async function handlePublish() {
    if (!selectedTemplate) return;
    setCreating(true);

    try {
      const res = await fetch("/api/v1/form-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          template_id: selectedTemplate.id === "blank" ? undefined : selectedTemplate.id,
          is_multi_step: selectedTemplate.isMultiStep,
          branding_overrides: {
            title: formName,
            primary_color: primaryColor,
            button_color: primaryColor,
            button_text: buttonText,
          },
        }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to create form");
      }

      const { data } = await res.json();
      toast.success("Form published and live!");
      router.push(`/forms/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create form");
      setCreating(false);
    }
  }

  const totalFields = selectedTemplate
    ? selectedTemplate.steps.reduce((acc, s) => acc + s.fields.length, 0)
    : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center gap-2 justify-center">
        {[
          { num: 1, label: "Template" },
          { num: 2, label: "Customize" },
          { num: 3, label: "Publish" },
        ].map(({ num, label }, i) => (
          <div key={num} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`w-8 h-0.5 ${step >= num ? "bg-primary" : "bg-border"}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > num
                    ? "bg-primary text-primary-foreground"
                    : step === num
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > num ? <Check className="h-3.5 w-3.5" /> : num}
              </div>
              <span
                className={`text-xs font-medium ${
                  step >= num ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Pick Template */}
      {step === 1 && (
        <TemplatePicker
          onSelect={handleTemplateSelect}
          selectedId={selectedTemplate?.id ?? null}
          industryId={industryId}
        />
      )}

      {/* Step 2: Quick Customize */}
      {step === 2 && selectedTemplate && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">Customize Your Form</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Adjust the basics. You can fine-tune everything later in the builder.
            </p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wiz-title">Form Title</Label>
                <Input
                  id="wiz-title"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Scholarship Application"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-color">Primary Color</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="wiz-color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#6366f1"
                    className="flex-1"
                  />
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-9 rounded border cursor-pointer"
                    aria-label="Pick color"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-btn">Button Text</Label>
                <Input
                  id="wiz-btn"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder="Submit"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!formName.trim()}>
              Next: Review <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Publish */}
      {step === 3 && selectedTemplate && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">Review & Publish</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Your form will be published immediately and accessible via your public link.
            </p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Template</span>
                <span className="text-sm font-medium">{selectedTemplate.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Form Title</span>
                <span className="text-sm font-medium">{formName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Primary Color</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded border"
                    style={{ backgroundColor: primaryColor }}
                  />
                  <span className="text-sm font-mono">{primaryColor}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Button Text</span>
                <span className="text-sm font-medium">{buttonText}</span>
              </div>
              {selectedTemplate.id !== "blank" && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Fields</span>
                  <span className="text-sm font-medium">
                    {selectedTemplate.steps.length} {selectedTemplate.steps.length === 1 ? "step" : "steps"},{" "}
                    {totalFields} fields
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Public URL</span>
                <span className="text-xs font-mono text-muted-foreground truncate max-w-[250px]">
                  /form/{tenantSlug}/...
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button onClick={handlePublish} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Publishing...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-1" /> Publish Form
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
