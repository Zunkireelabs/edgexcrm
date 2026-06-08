"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BuilderAction } from "../types";

const DEFAULT_SENTINEL = "__default__";

interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
}

interface PipelineRoutingEditorProps {
  targetPipelineId: string | null;
  dispatch: React.Dispatch<BuilderAction>;
}

export function PipelineRoutingEditor({ targetPipelineId, dispatch }: PipelineRoutingEditorProps) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/pipelines")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.data)) setPipelines(data.data);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, []);

  function handleChange(value: string) {
    dispatch({
      type: "SET_TARGET_PIPELINE_ID",
      payload: value === DEFAULT_SENTINEL ? null : value,
    });
  }

  const selectValue = targetPipelineId ?? DEFAULT_SENTINEL;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline Routing</CardTitle>
          <CardDescription>
            New leads from this form enter at the selected pipeline&apos;s first stage. Leave as
            Default to use your tenant&apos;s default pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={selectValue}
            onValueChange={handleChange}
            disabled={loading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select pipeline…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_SENTINEL}>Default pipeline</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.is_default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
