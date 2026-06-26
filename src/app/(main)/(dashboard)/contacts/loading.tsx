import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <Skeleton className="h-7 w-32 shrink-0 mb-4" />
      {/* toolbar */}
      <div className="shrink-0 bg-card rounded-lg border p-3 mb-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-60" />
          <div className="flex-1" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
      {/* table header */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24 ml-auto" />
        <Skeleton className="h-4 w-28" />
      </div>
      {/* rows */}
      <div className="space-y-px flex-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3 border-b">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
