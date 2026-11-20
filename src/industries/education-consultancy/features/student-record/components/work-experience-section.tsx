"use client";

import { Input } from "@/components/ui/input";
import { RepeatableList } from "./repeatable-list";
import { FieldLabel, useSetPlaceholder } from "./form-primitives";

export interface WorkExperienceEntry {
  id: string;
  institutionName: string;
  address: string;
  position: string;
  startDate: string;
  endDate: string;
}

export function createWorkExperience(): WorkExperienceEntry {
  return { id: crypto.randomUUID(), institutionName: "", address: "", position: "", startDate: "", endDate: "" };
}

export function WorkExperienceSection({
  isEditing,
  value,
  onChange,
}: {
  isEditing: boolean;
  value: WorkExperienceEntry[];
  onChange: (next: WorkExperienceEntry[]) => void;
}) {
  const setPh = useSetPlaceholder();
  return (
    <RepeatableList
      items={value}
      isEditing={isEditing}
      onChange={onChange}
      createItem={createWorkExperience}
      addLabel="Add Work Experience"
      emptyLabel="No work experience added yet."
      renderSummary={(item) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Name of Institution</FieldLabel>
            <p className="font-medium">{item.institutionName || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Position</FieldLabel>
            <p className="font-medium">{item.position || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Duration</FieldLabel>
            <p className="font-medium">
              {item.startDate || item.endDate ? `${item.startDate || "—"} to ${item.endDate || "—"}` : "—"}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <FieldLabel className="text-xs text-muted-foreground">Address</FieldLabel>
            <p className="font-medium">{item.address || "—"}</p>
          </div>
        </div>
      )}
      renderItem={(item, update) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Name of Institution</FieldLabel>
            <Input placeholder={setPh("Name of Institution")} value={item.institutionName} onChange={(e) => update({ institutionName: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Position</FieldLabel>
            <Input placeholder={setPh("Position")} value={item.position} onChange={(e) => update({ position: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <FieldLabel className="text-xs text-muted-foreground mb-1">Address</FieldLabel>
            <Input placeholder={setPh("Address")} value={item.address} onChange={(e) => update({ address: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Start Date</FieldLabel>
            <Input type="date" value={item.startDate} onChange={(e) => update({ startDate: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">End Date</FieldLabel>
            <Input type="date" value={item.endDate} onChange={(e) => update({ endDate: e.target.value })} className="h-9 text-sm" />
          </div>
        </div>
      )}
    />
  );
}
