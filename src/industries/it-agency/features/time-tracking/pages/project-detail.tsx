"use client";

interface ProjectDetailPageProps {
  tenantId: string;
  role: string;
  projectId: string;
}

export function ProjectDetailPage({ tenantId, role, projectId }: ProjectDetailPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Project</h1>
      <p className="text-muted-foreground mt-1">Coming soon — Phase 2</p>
    </div>
  );
}
