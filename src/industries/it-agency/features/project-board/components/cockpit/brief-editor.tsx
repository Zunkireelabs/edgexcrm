"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@/types/database";

interface BriefEditorProps {
  project: Project;
  isAdmin: boolean;
  onSave: (brief: string) => Promise<boolean>;
}

export function BriefEditor({ project, isAdmin, onSave }: BriefEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.brief ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const ok = await onSave(value.trim());
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Brief</CardTitle>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {project.brief ? "Edit" : "Add brief"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {project.brief ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">{project.brief}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No brief captured yet. A clear brief is the first decision this project&apos;s memory records.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Brief</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          placeholder="What is this project, for whom, and why does it matter?"
          disabled={saving}
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || value.trim().length === 0}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(project.brief ?? "");
              setEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
