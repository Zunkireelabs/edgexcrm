"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormAttribution } from "@/types/database";
import type { BuilderAction } from "../types";

const DEFAULT_SENTINEL = "__default__";

interface TenantBranch {
  id: string;
  name: string;
  is_default?: boolean;
}

interface BranchRoutingEditorProps {
  attribution: FormAttribution;
  dispatch: React.Dispatch<BuilderAction>;
}

// Always mounted (same convention as ListRoutingEditor) — a single-branch tenant
// just sees "Default branch" with no other options, which is harmless.
export function BranchRoutingEditor({ attribution, dispatch }: BranchRoutingEditorProps) {
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/branches")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.data)) setBranches(data.data);
      })
      .catch(() => { /* non-fatal — tenants without branches just see Default */ })
      .finally(() => setLoading(false));
  }, []);

  function handleChange(value: string) {
    // Stored inside the form's attribution JSONB — no schema change.
    dispatch({
      type: "SET_ATTRIBUTION",
      payload: { default_branch_id: value === DEFAULT_SENTINEL ? null : value },
    });
  }

  const selectValue = attribution.default_branch_id ?? DEFAULT_SENTINEL;
  const defaultBranch = branches.find((b) => b.is_default);
  const defaultLabel = defaultBranch ? `${defaultBranch.name} (tenant default)` : "Default branch";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Branch Routing</CardTitle>
        <CardDescription>
          Attribute new leads from this form to a specific branch instead of your
          default branch. Use this for a form embedded on a branch-specific landing
          page, so its leads reach the right branch team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selectValue} onValueChange={handleChange} disabled={loading}>
          <SelectTrigger>
            <SelectValue placeholder="Select branch…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_SENTINEL}>{defaultLabel}</SelectItem>
            {branches
              .filter((b) => !b.is_default)
              .map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
