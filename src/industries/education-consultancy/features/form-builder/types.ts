import type { FormStep, FormBranding, FormAttribution } from "@/types/database";

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  isMultiStep: boolean;
  steps: FormStep[];
  branding: Partial<FormBranding>;
}

export interface BuilderState {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  steps: FormStep[];
  branding: FormBranding;
  redirectUrl: string | null;
  attribution: FormAttribution;
  isDirty: boolean;
  saving: boolean;
}

export type BuilderAction =
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_SLUG"; payload: string }
  | { type: "TOGGLE_ACTIVE" }
  | { type: "SET_REDIRECT_URL"; payload: string | null }
  | { type: "ADD_STEP" }
  | { type: "REMOVE_STEP"; payload: number }
  | { type: "UPDATE_STEP_TITLE"; payload: { index: number; title: string } }
  | { type: "MOVE_STEP_UP"; payload: number }
  | { type: "MOVE_STEP_DOWN"; payload: number }
  | { type: "ADD_FIELD"; payload: { stepIndex: number; field: import("@/types/database").FormField } }
  | { type: "REMOVE_FIELD"; payload: { stepIndex: number; fieldIndex: number } }
  | { type: "UPDATE_FIELD"; payload: { stepIndex: number; fieldIndex: number; field: import("@/types/database").FormField } }
  | { type: "MOVE_FIELD_UP"; payload: { stepIndex: number; fieldIndex: number } }
  | { type: "MOVE_FIELD_DOWN"; payload: { stepIndex: number; fieldIndex: number } }
  | { type: "SET_BRANDING"; payload: Partial<FormBranding> }
  | { type: "SET_ATTRIBUTION"; payload: Partial<FormAttribution> }
  | { type: "SET_SAVING"; payload: boolean }
  | { type: "MARK_SAVED" };
