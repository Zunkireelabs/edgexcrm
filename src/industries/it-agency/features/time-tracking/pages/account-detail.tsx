"use client";

interface AccountDetailPageProps {
  tenantId: string;
  role: string;
  accountId: string;
}

export function AccountDetailPage({ tenantId, role, accountId }: AccountDetailPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="text-muted-foreground mt-1">Coming soon — Phase 2</p>
    </div>
  );
}
