"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SOURCE_KINDS, mergeSourceOptions, type SourceKind, type SourceOption } from "@/lib/leads/source-options";

type Lists = Record<SourceKind, SourceOption[]>;

const startingLists = (): Lists => ({
  category: mergeSourceOptions("category"),
  channel: mergeSourceOptions("channel"),
  account: mergeSourceOptions("account"),
});

/**
 * The Lead Source dropdown lists for Edit profile. Starts with the built-in lists so the dropdowns work at once (and keep working
 * if the request fails), then swaps in the tenant's lists, which include what an admin has added.
 */
export function useLeadSourceOptions(enabled: boolean) {
  const [lists, setLists] = useState<Lists>(startingLists);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/v1/lead-source-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: Partial<Lists> } | null) => {
        const data = body?.data;
        if (cancelled || !data) return;
        setLists((prev) => {
          const next = { ...prev };
          for (const kind of SOURCE_KINDS) if (Array.isArray(data[kind])) next[kind] = data[kind] as SourceOption[];
          return next;
        });
      })
      .catch(() => { /* keep the built-in lists */ });
    return () => { cancelled = true; };
  }, [enabled]);

  /** Saves a new option (owner/admin only, enforced by the server) and resolves with its stored value, or null on failure. */
  const addOption = useCallback(async (kind: SourceKind, label: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/v1/lead-source-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label }),
      });
      const body = (await res.json().catch(() => null)) as { data?: { value: string; label: string }; error?: { message?: string } } | null;
      if (!res.ok || !body?.data) {
        toast.error(body?.error?.message ?? "Could not add the option");
        return null;
      }
      const added = body.data;
      setLists((prev) => ({ ...prev, [kind]: mergeSourceOptions(kind, [...prev[kind], { value: added.value, label: added.label }]) }));
      return added.value;
    } catch {
      toast.error("Could not add the option");
      return null;
    }
  }, []);

  return { lists, addOption };
}
