"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ActivityRow } from "./activity-row";
import type { ActivityItem } from "./activity-row";

interface ActivityData {
  items: ActivityItem[];
  next_page: number | null;
}

interface ActivityTabProps {
  accountId: string;
  initialData: ActivityData | null;
}

export function ActivityTab({ accountId, initialData }: ActivityTabProps) {
  const [items, setItems] = useState<ActivityItem[]>(initialData?.items ?? []);
  const [nextPage, setNextPage] = useState<number | null>(initialData?.next_page ?? null);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!nextPage || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/activity?page=${nextPage}&limit=30`);
      const { data } = await res.json();
      setItems((prev) => [...prev, ...(data?.items ?? [])]);
      setNextPage(data?.next_page ?? null);
    } catch {
      toast.error("Failed to load more activity");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No activity yet on this account.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      <div>
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
      </div>

      {nextPage && (
        <div className="pt-3">
          <button
            type="button"
            className="text-sm text-primary hover:underline disabled:opacity-50 flex items-center gap-1.5"
            disabled={loading}
            onClick={loadMore}
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
