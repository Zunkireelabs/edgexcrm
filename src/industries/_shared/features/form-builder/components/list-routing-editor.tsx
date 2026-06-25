"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormAttribution } from "@/types/database";
import type { BuilderAction } from "../types";

const DEFAULT_SENTINEL = "__default__";

interface LeadList {
  id: string;
  name: string;
  is_intake?: boolean;
  is_archive?: boolean;
  is_staging?: boolean;
}

interface ListRoutingEditorProps {
  attribution: FormAttribution;
  dispatch: React.Dispatch<BuilderAction>;
}

export function ListRoutingEditor({ attribution, dispatch }: ListRoutingEditorProps) {
  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/lead-lists")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.data)) setLists(data.data);
      })
      .catch(() => { /* non-fatal — tenants without lists just see Default */ })
      .finally(() => setLoading(false));
  }, []);

  function handleChange(value: string) {
    // Stored inside the form's attribution JSONB — no schema change.
    dispatch({
      type: "SET_ATTRIBUTION",
      payload: { target_list_id: value === DEFAULT_SENTINEL ? null : value },
    });
  }

  const selectValue = attribution.target_list_id ?? DEFAULT_SENTINEL;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">List Routing</CardTitle>
        <CardDescription>
          Send new leads from this form into a specific list (a separate bucket), instead of your
          default intake list. Use this to keep campaign or event leads out of your normal funnel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selectValue} onValueChange={handleChange} disabled={loading}>
          <SelectTrigger>
            <SelectValue placeholder="Select list…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_SENTINEL}>Default (intake list)</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
                {l.is_intake ? " (intake)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
