"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
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
  const [editingField, setEditingField] = useState<{ field: FormField; fieldIndex: number } | null>(null);

  // Generate stable IDs for sortable — use field name + index as fallback
  const fieldIds = useMemo(
    () => step.fields.map((f, i) => `${stepIndex}-${f.name}-${i}`),
    [step.fields, stepIndex]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = fieldIds.indexOf(String(active.id));
    const newIndex = fieldIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newFields = arrayMove([...step.fields], oldIndex, newIndex);
    // Dispatch individual moves to match reducer pattern
    // We update the entire step's fields by dispatching UPDATE_FIELD for each
    // Simpler: dispatch remove + add in sequence, or use a direct field reorder
    // For now, use sequential MOVE_FIELD_UP/DOWN to get from oldIndex to newIndex
    if (oldIndex < newIndex) {
      for (let i = oldIndex; i < newIndex; i++) {
        dispatch({ type: "MOVE_FIELD_DOWN", payload: { stepIndex, fieldIndex: i } });
      }
    } else {
      for (let i = oldIndex; i > newIndex; i--) {
        dispatch({ type: "MOVE_FIELD_UP", payload: { stepIndex, fieldIndex: i } });
      }
    }
  }

  function handleAddField(field: FormField) {
    dispatch({ type: "ADD_FIELD", payload: { stepIndex, field } });
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
      <Card className="border shadow-none">
        {/* Step header — read-only, set by developers */}
        {totalSteps > 1 && (
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {stepIndex + 1}
              </div>
              <span className="text-sm font-semibold">{step.title}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {step.fields.length} {step.fields.length === 1 ? "field" : "fields"}
              </span>
            </div>
          </CardHeader>
        )}

        <CardContent className={`px-4 pb-4 ${totalSteps > 1 ? "pt-0" : "pt-4"} space-y-1.5`}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
                {step.fields.map((field, fieldIndex) => (
                  <FieldRow
                    key={fieldIds[fieldIndex]}
                    field={field}
                    fieldId={fieldIds[fieldIndex]}
                    fieldIndex={fieldIndex}
                    stepIndex={stepIndex}
                    totalFields={step.fields.length}
                    onEdit={() => setEditingField({ field, fieldIndex })}
                    onRemove={() =>
                      dispatch({ type: "REMOVE_FIELD", payload: { stepIndex, fieldIndex } })
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
              </SortableContext>
            </DndContext>

            <FieldTypePicker onSelect={handleAddField} />
          </CardContent>
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
