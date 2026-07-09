"use client";

import { useProjectReconciliation } from "../../hooks/use-project-reconciliation";
import { useProjectStatusReports } from "../../hooks/use-project-status-reports";
import { ReconciliationPanel } from "./reconciliation-panel";
import { StatusReportsPanel } from "./status-reports-panel";

interface ReportsTabProps {
  projectId: string;
  isAdmin: boolean;
  onEventRecorded: () => void;
}

export function ReportsTab({ projectId, isAdmin, onEventRecorded }: ReportsTabProps) {
  const reconciliation = useProjectReconciliation(projectId);
  const statusReports = useProjectStatusReports(projectId);

  async function handleReconcile(taskId: string) {
    const ok = await reconciliation.reconcileTask(taskId);
    if (ok) onEventRecorded();
    return ok;
  }

  async function handlePublish(id: string) {
    const ok = await statusReports.publish(id);
    if (ok) onEventRecorded();
    return ok;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ReconciliationPanel
        tasks={reconciliation.tasks}
        rollup={reconciliation.rollup}
        loading={reconciliation.loading}
        isAdmin={isAdmin}
        onReconcile={handleReconcile}
      />
      <StatusReportsPanel
        reports={statusReports.reports}
        loading={statusReports.loading}
        isAdmin={isAdmin}
        onCreateDraft={statusReports.createDraft}
        onPublish={handlePublish}
      />
    </div>
  );
}
