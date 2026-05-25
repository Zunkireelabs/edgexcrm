"use client";

interface ApprovalsQueuePageProps {
  tenantId: string;
  role: string;
}

export function ApprovalsQueuePage({ tenantId, role }: ApprovalsQueuePageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="text-muted-foreground mt-1">Coming soon — Phase 4</p>
    </div>
  );
}
