"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Plus, Loader2, ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { FormConfig } from "@/types/database";
import { useFormBuilder } from "../hooks/use-form-builder";
import { StepEditor } from "./step-editor";
import { BrandingEditor } from "./branding-editor";
import { slugify } from "../lib/validation";

interface FormBuilderPageProps {
  formConfig: FormConfig;
  tenantSlug: string;
}

export function FormBuilderPage({ formConfig, tenantSlug }: FormBuilderPageProps) {
  const { state, dispatch, save } = useFormBuilder(formConfig);
  const [slugEditing, setSlugEditing] = useState(false);

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

          {/* View live */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(publicFormUrl, "_blank")}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Preview
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

      {/* Main content */}
      <Tabs defaultValue="steps" className="flex-1">
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
  );
}
