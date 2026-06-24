import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      {/* header: title + pipeline selector */}
      <div className="flex items-center gap-3 shrink-0 mb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-8 w-44" />
      </div>
      {/* toolbar */}
      <div className="shrink-0 bg-card rounded-lg border p-3 mb-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-60" />
          <Skeleton className="h-7 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
      {/* kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1 min-h-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-72 flex flex-col gap-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
