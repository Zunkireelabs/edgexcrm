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
} from "@dnd-kit/sortable";
// Card imports removed — using custom div layout for cleaner design
import type { FormStep, FormField } from "@/types/database";
import { FieldRow } from "./field-row";
import { FieldTypePicker } from "./field-type-picker";
import { FieldEditor } from "./field-editor";
import type { BuilderAction } from "../types";
import { toFieldName } from "../lib/validation";

interface StepEditorProps {
  step: FormStep;
  stepIndex: number;
  totalSteps: number;
  dispatch: React.Dispatch<BuilderAction>;
  industryId?: string | null;
}

// Reserved field names locked to real `leads` columns (see field-type-picker.tsx)
// — inline label-driven rename must not touch their key either.
const RESERVED_FIELD_NAMES = new Set(["destinations", "field_of_study"]);

export function StepEditor({ step, stepIndex, totalSteps, dispatch, industryId }: StepEditorProps) {
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
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 overflow-hidden">
        {/* Step header — read-only, set by developers */}
        {totalSteps > 1 && (
          <div className="px-5 py-3 border-b border-gray-100 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">
                {stepIndex + 1}
              </div>
              <span className="text-sm font-bold text-gray-900">{step.title}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {step.fields.length} {step.fields.length === 1 ? "field" : "fields"}
              </span>
            </div>
          </div>
        )}

        <div className={`px-4 pb-4 ${totalSteps > 1 ? "pt-3" : "pt-4"} space-y-2`}>
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
                          field: RESERVED_FIELD_NAMES.has(field.name)
                            ? { ...field, label: newLabel }
                            : { ...field, label: newLabel, name: toFieldName(newLabel) || field.name },
                        },
                      });
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>

            <FieldTypePicker onSelect={handleAddField} industryId={industryId} />
          </div>
      </div>

      <FieldEditor
        field={editingField?.field ?? null}
        open={editingField !== null}
        onClose={() => setEditingField(null)}
        onSave={handleSaveField}
      />
    </>
  );
}
