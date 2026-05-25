"use client";

interface AccountsListPageProps {
  tenantId: string;
  role: string;
}

export function AccountsListPage({ tenantId, role }: AccountsListPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <p className="text-muted-foreground mt-1">Coming soon — Phase 2</p>
    </div>
  );
}
