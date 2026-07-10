"use client";

import { BookOpen } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function CoursesManager() {
  return (
    <LookupTableManager
      id="courses"
      title="Fields of Study"
      icon={BookOpen}
      apiPath="/api/v1/courses"
      itemLabel="Course"
      description="Manage fields of study that appear in lead forms."
      namePlaceholder="e.g. Engineering & Technology"
      descriptionPlaceholder="Optional notes about this field of study"
      emptyMessage="No courses yet. Add fields of study to use them in lead forms."
    />
  );
}
