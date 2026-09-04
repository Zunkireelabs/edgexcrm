import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function CardSkeleton({ titleWidth = "w-20", rows = 3, withAction = false }: { titleWidth?: string; rows?: number; withAction?: boolean }) {
  return (
    <Card className="border-sidebar-border rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            <Skeleton className={`h-4 ${titleWidth}`} />
          </CardTitle>
          {withAction && <Skeleton className="h-3 w-16" />}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-0.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 py-2 px-1">
            <Skeleton className="h-2 w-2 rounded-full shrink-0 mt-1.5" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DayGlanceRailSkeleton() {
  return (
    <div className="lg:sticky lg:top-6 lg:h-[calc(100vh_-_140px)] lg:overflow-hidden lg:shrink-0 lg:border-l lg:border-border lg:pl-6 pt-16 lg:w-[300px]">
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3 w-32 mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border-0 bg-sidebar-bg shadow-sm px-3 py-2.5">
                <Skeleton className="h-5 w-5 shrink-0 self-center rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-6 mx-auto" />
                  <Skeleton className="h-3 w-16 mx-auto" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <Skeleton className="h-4 w-24 mb-4" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-[8px]" />
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <div className="rounded-lg p-4 flex items-start gap-3 bg-blue-50/60 dark:bg-blue-950/20">
            <Skeleton className="h-4 w-4 mt-0.5 shrink-0 rounded" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-0 items-start">
      <div className="min-w-0 space-y-3 lg:pr-6">
        <div className="mb-6">
          <Skeleton className="h-7 w-56 mb-1" />
          <Skeleton className="h-3 w-48" />
        </div>

        <div className="flex items-center gap-4 border-b border-border pb-3">
          {["w-16", "w-16", "w-12", "w-16"].map((w, i) => (
            <Skeleton key={i} className={`h-4 ${w}`} />
          ))}
        </div>

        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton titleWidth="w-16" rows={3} />
            <CardSkeleton titleWidth="w-16" rows={3} withAction />
          </div>

          <div>
            <Skeleton className="h-3 w-32 mb-2" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CardSkeleton titleWidth="w-16" rows={4} withAction />
              <CardSkeleton titleWidth="w-12" rows={4} withAction />
            </div>
          </div>

          <CardSkeleton titleWidth="w-28" rows={4} />
        </div>
      </div>

      <DayGlanceRailSkeleton />
    </div>
  );
}
