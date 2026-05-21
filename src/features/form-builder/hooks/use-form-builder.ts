"use client";

import { useReducer, useCallback } from "react";
import { toast } from "sonner";
import type { FormStep, FormBranding } from "@/types/database";
import type { BuilderState, BuilderAction } from "../types";

function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.payload, isDirty: true };

    case "SET_SLUG":
      return { ...state, slug: action.payload, isDirty: true };

    case "TOGGLE_ACTIVE":
      return { ...state, isActive: !state.isActive, isDirty: true };

    case "SET_REDIRECT_URL":
      return { ...state, redirectUrl: action.payload, isDirty: true };

    case "ADD_STEP": {
      const newStep: FormStep = { title: `Step ${state.steps.length + 1}`, fields: [] };
      return { ...state, steps: [...state.steps, newStep], isDirty: true };
    }

    case "REMOVE_STEP": {
      if (state.steps.length <= 1) return state;
      const steps = state.steps.filter((_, i) => i !== action.payload);
      return { ...state, steps, isDirty: true };
    }

    case "UPDATE_STEP_TITLE": {
      const steps = state.steps.map((step, i) =>
        i === action.payload.index ? { ...step, title: action.payload.title } : step
      );
      return { ...state, steps, isDirty: true };
    }

    case "MOVE_STEP_UP": {
      const idx = action.payload;
      if (idx === 0) return state;
      const steps = [...state.steps];
      [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]];
      return { ...state, steps, isDirty: true };
    }

    case "MOVE_STEP_DOWN": {
      const idx = action.payload;
      if (idx === state.steps.length - 1) return state;
      const steps = [...state.steps];
      [steps[idx], steps[idx + 1]] = [steps[idx + 1], steps[idx]];
      return { ...state, steps, isDirty: true };
    }

    case "ADD_FIELD": {
      const steps = state.steps.map((step, i) =>
        i === action.payload.stepIndex
          ? { ...step, fields: [...step.fields, action.payload.field] }
          : step
      );
      return { ...state, steps, isDirty: true };
    }

    case "REMOVE_FIELD": {
      const steps = state.steps.map((step, i) =>
        i === action.payload.stepIndex
          ? { ...step, fields: step.fields.filter((_, j) => j !== action.payload.fieldIndex) }
          : step
      );
      return { ...state, steps, isDirty: true };
    }

    case "UPDATE_FIELD": {
      const steps = state.steps.map((step, i) =>
        i === action.payload.stepIndex
          ? {
              ...step,
              fields: step.fields.map((f, j) =>
                j === action.payload.fieldIndex ? action.payload.field : f
              ),
            }
          : step
      );
      return { ...state, steps, isDirty: true };
    }

    case "MOVE_FIELD_UP": {
      const { stepIndex, fieldIndex } = action.payload;
      if (fieldIndex === 0) return state;
      const steps = state.steps.map((step, i) => {
        if (i !== stepIndex) return step;
        const fields = [...step.fields];
        [fields[fieldIndex - 1], fields[fieldIndex]] = [fields[fieldIndex], fields[fieldIndex - 1]];
        return { ...step, fields };
      });
      return { ...state, steps, isDirty: true };
    }

    case "MOVE_FIELD_DOWN": {
      const { stepIndex, fieldIndex } = action.payload;
      const step = state.steps[stepIndex];
      if (fieldIndex === step.fields.length - 1) return state;
      const steps = state.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        const fields = [...s.fields];
        [fields[fieldIndex], fields[fieldIndex + 1]] = [fields[fieldIndex + 1], fields[fieldIndex]];
        return { ...s, fields };
      });
      return { ...state, steps, isDirty: true };
    }

    case "SET_BRANDING":
      return { ...state, branding: { ...state.branding, ...action.payload }, isDirty: true };

    case "SET_SAVING":
      return { ...state, saving: action.payload };

    case "MARK_SAVED":
      return { ...state, isDirty: false, saving: false };

    default:
      return state;
  }
}

function buildInitialState(formConfig: {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  steps: FormStep[];
  branding: FormBranding;
  redirect_url: string | null;
}): BuilderState {
  return {
    id: formConfig.id,
    name: formConfig.name,
    slug: formConfig.slug,
    isActive: formConfig.is_active,
    steps: formConfig.steps,
    branding: formConfig.branding,
    redirectUrl: formConfig.redirect_url,
    isDirty: false,
    saving: false,
  };
}

export function useFormBuilder(initialConfig: Parameters<typeof buildInitialState>[0]) {
  const [state, dispatch] = useReducer(builderReducer, buildInitialState(initialConfig));

  const save = useCallback(async () => {
    dispatch({ type: "SET_SAVING", payload: true });
    try {
      const res = await fetch(`/api/v1/form-configs/${state.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          slug: state.slug,
          is_active: state.isActive,
          steps: state.steps,
          branding: state.branding,
          redirect_url: state.redirectUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        // Show specific validation errors if available
        if (data.error?.details) {
          const details = data.error.details;
          const messages = Object.entries(details)
            .map(([key, msgs]) => `${key}: ${(msgs as string[]).join(", ")}`)
            .join("\n");
          throw new Error(messages || "Validation failed");
        }
        throw new Error(data.error?.message ?? "Failed to save");
      }

      dispatch({ type: "MARK_SAVED" });
      toast.success("Form saved");
    } catch (err) {
      dispatch({ type: "SET_SAVING", payload: false });
      toast.error(err instanceof Error ? err.message : "Failed to save form");
    }
  }, [state]);

  return { state, dispatch, save };
}
