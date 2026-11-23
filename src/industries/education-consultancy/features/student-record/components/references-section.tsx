"use client";

import { Input } from "@/components/ui/input";
import { RepeatableList } from "./repeatable-list";
import { FieldLabel, useSetPlaceholder } from "./form-primitives";

export interface ReferenceEntry {
  id: string;
  refereeName: string;
  position: string;
  organization: string;
  email: string;
  address: string;
  relationship: string;
}

export function createReference(): ReferenceEntry {
  return { id: crypto.randomUUID(), refereeName: "", position: "", organization: "", email: "", address: "", relationship: "" };
}

export function ReferencesSection({
  isEditing,
  value,
  onChange,
}: {
  isEditing: boolean;
  value: ReferenceEntry[];
  onChange: (next: ReferenceEntry[]) => void;
}) {
  const setPh = useSetPlaceholder();
  return (
    <RepeatableList
      items={value}
      isEditing={isEditing}
      onChange={onChange}
      createItem={createReference}
      addLabel="Add Reference"
      emptyLabel="No references added yet."
      renderSummary={(item) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Name of Referee</FieldLabel>
            <p className="font-medium">{item.refereeName || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Position</FieldLabel>
            <p className="font-medium">{item.position || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Organization</FieldLabel>
            <p className="font-medium">{item.organization || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Email</FieldLabel>
            <p className="font-medium">{item.email || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Relationship with Applicant</FieldLabel>
            <p className="font-medium">{item.relationship || "—"}</p>
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground">Address</FieldLabel>
            <p className="font-medium">{item.address || "—"}</p>
          </div>
        </div>
      )}
      renderItem={(item, update) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Name of Referee</FieldLabel>
            <Input placeholder={setPh("Name of Referee")} value={item.refereeName} onChange={(e) => update({ refereeName: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Position</FieldLabel>
            <Input placeholder={setPh("Position")} value={item.position} onChange={(e) => update({ position: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Organization</FieldLabel>
            <Input placeholder={setPh("Organization")} value={item.organization} onChange={(e) => update({ organization: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Email</FieldLabel>
            <Input placeholder={setPh("Email")} type="email" value={item.email} onChange={(e) => update({ email: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Relationship with Applicant</FieldLabel>
            <Input placeholder={setPh("Relationship with Applicant")} value={item.relationship} onChange={(e) => update({ relationship: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <FieldLabel className="text-xs text-muted-foreground mb-1">Address</FieldLabel>
            <Input placeholder={setPh("Address")} value={item.address} onChange={(e) => update({ address: e.target.value })} className="h-9 text-sm" />
          </div>
        </div>
      )}
    />
  );
}
