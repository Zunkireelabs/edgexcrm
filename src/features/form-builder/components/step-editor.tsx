"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { FormStep, FormField } from "@/types/database";
import { FieldRow } from "./field-row";
import { FieldTypePicker } from "./field-type-picker";
import { FieldEditor } from "./field-editor";
import type { BuilderAction } from "../types";
import { slugify } from "../lib/validation";

interface StepEditorProps {
  step: FormStep;
  stepIndex: number;
  totalSteps: number;
  dispatch: React.Dispatch<BuilderAction>;
}

export function StepEditor({ step, stepIndex, totalSteps, dispatch }: StepEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingField, setEditingField] = useState<{ field: FormField; fieldIndex: number } | null>(null);

  function handleAddField(field: FormField) {
    dispatch({ type: "ADD_FIELD", payload: { stepIndex, field } });
    // Open editor for the new field immediately
    setEditingField({ field, fieldIndex: step.fields.length });
  }

  function handleSaveField(updatedField: FormField) {
    if (editingField === null) return;
    dispatch({
      type: "UPDATE_FIELD",
      payload: { stepIndex, fieldIndex: editingField.fieldIndex, field: updatedField },
    });
    setEditingField(null);
  }

  return (
    <>
      <Card className="border">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center gap-2">
            {/* Step reorder */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                onClick={() => dispatch({ type: "MOVE_STEP_UP", payload: stepIndex })}
                disabled={stepIndex === 0}
                aria-label="Move step up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                onClick={() => dispatch({ type: "MOVE_STEP_DOWN", payload: stepIndex })}
                disabled={stepIndex === totalSteps - 1}
                aria-label="Move step down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Step number badge */}
            <span className="text-xs font-bold text-muted-foreground shrink-0 w-6 text-center">
              {stepIndex + 1}
            </span>

            {/* Step title input */}
            <Input
              value={step.title}
              onChange={(e) =>
                dispatch({ type: "UPDATE_STEP_TITLE", payload: { index: stepIndex, title: e.target.value } })
              }
              className="h-8 text-sm font-medium flex-1"
              placeholder="Step title"
            />

            {/* Collapse toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand step" : "Collapse step"}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>

            {/* Delete step */}
            {totalSteps > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                onClick={() => dispatch({ type: "REMOVE_STEP", payload: stepIndex })}
                aria-label="Remove step"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {!collapsed && (
            <p className="text-xs text-muted-foreground ml-12">
              {step.fields.length} {step.fields.length === 1 ? "field" : "fields"}
            </p>
          )}
        </CardHeader>

        {!collapsed && (
          <CardContent className="px-4 pb-4 pt-0 space-y-1.5">
            {step.fields.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3 border rounded-md border-dashed">
                No fields yet. Add a field below.
              </p>
            )}

            {step.fields.map((field, fieldIndex) => (
              <FieldRow
                key={`${field.name}-${fieldIndex}`}
                field={field}
                fieldIndex={fieldIndex}
                stepIndex={stepIndex}
                totalFields={step.fields.length}
                onEdit={() => setEditingField({ field, fieldIndex })}
                onRemove={() =>
                  dispatch({ type: "REMOVE_FIELD", payload: { stepIndex, fieldIndex } })
                }
                onMoveUp={() =>
                  dispatch({ type: "MOVE_FIELD_UP", payload: { stepIndex, fieldIndex } })
                }
                onMoveDown={() =>
                  dispatch({ type: "MOVE_FIELD_DOWN", payload: { stepIndex, fieldIndex } })
                }
                onUpdateLabel={(newLabel) => {
                  dispatch({
                    type: "UPDATE_FIELD",
                    payload: {
                      stepIndex,
                      fieldIndex,
                      field: { ...field, label: newLabel, name: slugify(newLabel) || field.name },
                    },
                  });
                }}
              />
            ))}

            <FieldTypePicker onSelect={handleAddField} />
          </CardContent>
        )}
      </Card>

      <FieldEditor
        field={editingField?.field ?? null}
        open={editingField !== null}
        onClose={() => setEditingField(null)}
        onSave={handleSaveField}
      />
    </>
  );
}
