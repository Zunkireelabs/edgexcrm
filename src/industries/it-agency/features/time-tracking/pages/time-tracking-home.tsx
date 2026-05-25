"use client";

interface TimeTrackingHomePageProps {
  tenantId: string;
  role: string;
}

export function TimeTrackingHomePage({ tenantId, role }: TimeTrackingHomePageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Time Tracking</h1>
      <p className="text-muted-foreground mt-1">Coming soon — Phase 3</p>
    </div>
  );
}
