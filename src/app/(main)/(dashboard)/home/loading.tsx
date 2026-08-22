import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ titleWidth = "w-24", rows = 3 }: { titleWidth?: string; rows?: number }) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <Skeleton className={`h-4 ${titleWidth}`} />
      <div className="space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2 px-1">
            <Skeleton className="h-2 w-2 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="px-4 py-6 max-w-4xl mx-auto w-full space-y-4">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Skeleton className="h-4 w-72 mb-4" />
      <div className="space-y-4">
        <CardSkeleton titleWidth="w-20" rows={3} />
        <CardSkeleton titleWidth="w-16" rows={3} />
        <CardSkeleton titleWidth="w-20" rows={4} />
        <CardSkeleton titleWidth="w-14" rows={3} />
        <CardSkeleton titleWidth="w-28" rows={4} />
      </div>
    </div>
  );
}
