"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Generic "add as many as you need" list building block — the PDF calls for
 * this exact shape in three places (Test Scores, Work Experience, References:
 * "let us add as many"). Built once here so all three reuse the same
 * add/remove interaction instead of three separate implementations.
 */
interface RepeatableListProps<T> {
  items: T[];
  isEditing: boolean;
  onChange: (items: T[]) => void;
  createItem: () => T;
  /** Edit-mode card body for one entry. */
  renderItem: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  /** Read-only preview row for one entry. */
  renderSummary: (item: T) => React.ReactNode;
  addLabel: string;
  emptyLabel: string;
}

export function RepeatableList<T extends { id: string }>({
  items,
  isEditing,
  onChange,
  createItem,
  renderItem,
  renderSummary,
  addLabel,
  emptyLabel,
}: RepeatableListProps<T>) {
  const update = (id: string, patch: Partial<T>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const remove = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const add = () => {
    onChange([...items, createItem()]);
  };

  if (!isEditing) {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
    }
    return <div className="space-y-3">{items.map((item) => <div key={item.id}>{renderSummary(item)}</div>)}</div>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="relative rounded-md border p-3 pr-10">
          <button
            type="button"
            onClick={() => remove(item.id)}
            className="absolute top-2 right-2 text-muted-foreground hover:text-destructive"
            aria-label="Remove entry"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {renderItem(item, (patch) => update(item.id, patch))}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        {addLabel}
      </Button>
    </div>
  );
}
