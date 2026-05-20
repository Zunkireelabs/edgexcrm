"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Plus, Loader2, ExternalLink, ToggleLeft, ToggleRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { FormConfig, FormStep, FormField, FormBranding } from "@/types/database";
import { useFormBuilder } from "../hooks/use-form-builder";
import { StepEditor } from "./step-editor";
import { BrandingEditor } from "./branding-editor";
import { slugify } from "../lib/validation";

interface FormBuilderPageProps {
  formConfig: FormConfig;
  tenantSlug: string;
}

function LivePreview({ steps, branding, currentStep }: { steps: FormStep[]; branding: FormBranding; currentStep: number }) {
  const step = steps[currentStep] || steps[0];
  if (!step) return null;

  const primaryColor = branding.primary_color || "#6366f1";

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden h-fit">
      {/* Form header */}
      <div className="px-5 py-4" style={{ background: primaryColor }}>
        {branding.logo_url && (
          <img src={branding.logo_url} alt="" className="h-8 mb-2 object-contain" />
        )}
        <h3 className="text-white font-bold text-sm">{branding.title || "Untitled Form"}</h3>
        {branding.subtitle && (
          <p className="text-white/70 text-xs mt-0.5">{branding.subtitle}</p>
        )}
      </div>

      {/* Step progress */}
      {steps.length > 1 && (
        <div className="flex gap-1 px-5 pt-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full"
              style={{ background: i <= currentStep ? primaryColor : "#e5e7eb" }}
            />
          ))}
        </div>
      )}

      {/* Fields */}
      <div className="px-5 py-4 space-y-3">
        {steps.length > 1 && (
          <p className="text-xs font-medium text-gray-500">{step.title}</p>
        )}
        {step.fields.map((field, i) => (
          <PreviewField key={i} field={field} branding={branding} />
        ))}
      </div>

      {/* Submit button */}
      <div className="px-5 pb-5">
        <div
          className="w-full text-center py-2.5 rounded-lg text-white text-sm font-semibold"
          style={{ background: branding.button_color || primaryColor }}
        >
          {steps.length > 1 && currentStep < steps.length - 1
            ? "Next"
            : branding.button_text || "Submit"}
        </div>
      </div>
    </div>
  );
}

function PreviewField({ field, branding }: { field: FormField; branding: FormBranding }) {
  const hideLabels = branding.hide_labels ?? false;

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input type="checkbox" className="mt-0.5 rounded" disabled />
        <span>{field.label} {field.required && <span className="text-red-500">*</span>}</span>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        {!hideLabels && (
          <p className="text-xs font-medium text-gray-700 mb-1">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </p>
        )}
        <div className="h-16 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-400">
          {field.placeholder || ""}
        </div>
      </div>
    );
  }

  if (field.type === "select" || field.type === "radio") {
    return (
      <div>
        {!hideLabels && (
          <p className="text-xs font-medium text-gray-700 mb-1">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </p>
        )}
        <div className="h-8 rounded-md border border-gray-200 bg-gray-50 px-2.5 flex items-center justify-between text-xs text-gray-400">
          <span>{field.placeholder || "Select..."}</span>
          <span>▾</span>
        </div>
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <div>
        {!hideLabels && (
          <p className="text-xs font-medium text-gray-700 mb-1">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </p>
        )}
        <div className="h-8 rounded-md border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
          Click to upload
        </div>
      </div>
    );
  }

  return (
    <div>
      {!hideLabels && (
        <p className="text-xs font-medium text-gray-700 mb-1">
          {field.label} {field.required && <span className="text-red-500">*</span>}
        </p>
      )}
      <div className="h-8 rounded-md border border-gray-200 bg-gray-50 px-2.5 flex items-center text-xs text-gray-400">
        {field.placeholder || ""}
      </div>
    </div>
  );
}

export function FormBuilderPage({ formConfig, tenantSlug }: FormBuilderPageProps) {
  const { state, dispatch, save } = useFormBuilder(formConfig);
  const [slugEditing, setSlugEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewStep, setPreviewStep] = useState(0);

  const publicFormUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/form/${tenantSlug}/${state.slug}`;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/forms">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Forms
          </Link>
        </Button>

        <div className="flex-1 min-w-0">
          <Input
            value={state.name}
            onChange={(e) => {
              dispatch({ type: "SET_NAME", payload: e.target.value });
              if (!slugEditing) {
                dispatch({ type: "SET_SLUG", payload: slugify(e.target.value) });
              }
            }}
            className="text-lg font-semibold h-9 border-0 shadow-none px-0 focus-visible:ring-0 bg-transparent"
            placeholder="Form name"
          />
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <span>/form/{tenantSlug}/</span>
            {slugEditing ? (
              <Input
                value={state.slug}
                onChange={(e) => dispatch({ type: "SET_SLUG", payload: slugify(e.target.value) || e.target.value })}
                onBlur={() => setSlugEditing(false)}
                className="h-5 text-xs px-1 w-36 inline-flex border-b border-t-0 border-l-0 border-r-0 rounded-none focus-visible:ring-0"
                autoFocus
              />
            ) : (
              <button
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setSlugEditing(true)}
                title="Edit slug"
              >
                {state.slug}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Active toggle */}
          <button
            className="flex items-center gap-1.5 text-sm"
            onClick={() => dispatch({ type: "TOGGLE_ACTIVE" })}
            title={state.isActive ? "Deactivate form" : "Activate form"}
          >
            {state.isActive ? (
              <>
                <ToggleRight className="h-5 w-5 text-green-500" />
                <Badge variant="default" className="text-xs">Active</Badge>
              </>
            ) : (
              <>
                <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              </>
            )}
          </button>

          {/* Toggle preview */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {showPreview ? "Hide Preview" : "Preview"}
          </Button>

          {/* View live */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(publicFormUrl, "_blank")}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Open Live
          </Button>

          {/* Save */}
          <Button
            size="sm"
            onClick={save}
            disabled={state.saving || !state.isDirty}
          >
            {state.saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {state.isDirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      {/* Main content — split layout */}
      <div className={`flex gap-6 flex-1 min-h-0 ${showPreview ? "" : ""}`}>
        {/* Editor panel */}
        <div className={`${showPreview ? "flex-1 min-w-0" : "w-full"} overflow-y-auto`}>
          <Tabs defaultValue="steps">
            <TabsList className="mb-4">
              <TabsTrigger value="steps">
                Steps & Fields
                <Badge variant="secondary" className="ml-1.5 text-xs">{state.steps.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="branding">Branding</TabsTrigger>
            </TabsList>

            <TabsContent value="steps" className="space-y-3">
              {state.steps.map((step, stepIndex) => (
                <StepEditor
                  key={stepIndex}
                  step={step}
                  stepIndex={stepIndex}
                  totalSteps={state.steps.length}
                  dispatch={dispatch}
                />
              ))}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => dispatch({ type: "ADD_STEP" })}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Step
              </Button>
            </TabsContent>

            <TabsContent value="branding">
              <BrandingEditor
                branding={state.branding}
                redirectUrl={state.redirectUrl}
                dispatch={dispatch}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Live preview panel */}
        {showPreview && (
          <div className="w-[320px] shrink-0 overflow-y-auto sticky top-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Preview</p>
              {state.steps.length > 1 && (
                <div className="flex items-center gap-1">
                  {state.steps.map((_, i) => (
                    <button
                      key={i}
                      className={`w-6 h-6 rounded text-xs font-bold ${
                        previewStep === i
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                      onClick={() => setPreviewStep(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <LivePreview
              steps={state.steps}
              branding={state.branding}
              currentStep={Math.min(previewStep, state.steps.length - 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
