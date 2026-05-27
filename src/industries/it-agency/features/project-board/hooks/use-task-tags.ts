"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

export function useTaskTags() {
  const [tags, setTags] = useState<string[]>([]);

  const refetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/tasks/tags");
      if (!res.ok) throw new Error("Failed to fetch tags");
      const json = await res.json();
      setTags(json.data ?? []);
    } catch {
      toast.warning("Could not load tag suggestions");
    }
  }, []);

  useEffect(() => {
    refetchTags();
  }, [refetchTags]);

  return { tags, refetchTags };
}
