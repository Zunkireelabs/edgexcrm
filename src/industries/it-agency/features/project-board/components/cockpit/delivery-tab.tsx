"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectIssues } from "../../hooks/use-project-issues";
import { useProjectMilestones } from "../../hooks/use-project-milestones";
import { useProjectChangeRequests } from "../../hooks/use-project-change-requests";
import { IssuesPanel } from "./issues-panel";
import { MilestonesPanel } from "./milestones-panel";
import { ChangeRequestsPanel, type ChangeRequestPrefill } from "./change-requests-panel";
import type { ProjectIssue } from "@/types/database";

interface DeliveryTabProps {
  projectId: string;
  isAdmin: boolean;
  onProjectChanged: () => void;
  onEventRecorded: () => void;
}

export function DeliveryTab({ projectId, isAdmin, onProjectChanged, onEventRecorded }: DeliveryTabProps) {
  const issuesState = useProjectIssues(projectId);
  const milestonesState = useProjectMilestones(projectId);
  const changeRequestsState = useProjectChangeRequests(projectId);
  const [crPrefill, setCrPrefill] = useState<ChangeRequestPrefill | null>(null);
  const [committingPlan, setCommittingPlan] = useState(false);

  async function handleCommitPlan() {
    setCommittingPlan(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/commit-plan`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to commit plan");
        return;
      }
      toast.success(`Plan committed: ${json.data.task_count} task(s), ${Math.round(json.data.planned_minutes / 60)}h planned`);
      onEventRecorded();
    } finally {
      setCommittingPlan(false);
    }
  }

  function handlePromoteToChangeRequest(issue: ProjectIssue) {
    setCrPrefill({ title: `Scope change: ${issue.title}`, originIssueId: issue.id });
  }

  async function handleAcceptMilestone(id: string) {
    const ok = await milestonesState.acceptMilestone(id);
    if (ok) onProjectChanged();
    return ok;
  }

  async function handleTransitionMilestone(id: string, to: string) {
    const ok = await milestonesState.transitionMilestone(id, to);
    if (ok) onEventRecorded();
    return ok;
  }

  async function handleApproveCr(id: string, clientApproved: boolean) {
    const ok = await changeRequestsState.approveChangeRequest(id, clientApproved);
    if (ok) onProjectChanged();
    return ok;
  }

  async function handleRejectCr(id: string) {
    const ok = await changeRequestsState.rejectChangeRequest(id);
    if (ok) onProjectChanged();
    return ok;
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={handleCommitPlan} disabled={committingPlan}>
            {committingPlan ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
            )}
            Commit plan
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IssuesPanel
          issues={issuesState.issues}
          loading={issuesState.loading}
          isAdmin={isAdmin}
          onCreate={issuesState.createIssue}
          onResolve={(id) => issuesState.updateIssue(id, { status: "resolved" })}
          onPromoteToChangeRequest={handlePromoteToChangeRequest}
        />
        <MilestonesPanel
          milestones={milestonesState.milestones}
          loading={milestonesState.loading}
          isAdmin={isAdmin}
          onCreate={milestonesState.createMilestone}
          onAccept={handleAcceptMilestone}
          onReject={(id) => milestonesState.rejectMilestone(id)}
          onTransition={handleTransitionMilestone}
        />
        <div className="md:col-span-2">
          <ChangeRequestsPanel
            changeRequests={changeRequestsState.changeRequests}
            loading={changeRequestsState.loading}
            isAdmin={isAdmin}
            prefill={crPrefill}
            onPrefillConsumed={() => setCrPrefill(null)}
            onCreate={changeRequestsState.createChangeRequest}
            onApprove={handleApproveCr}
            onReject={handleRejectCr}
          />
        </div>
      </div>
    </div>
  );
}
