"use client";

import { useState } from "react";
import { useProjectIssues } from "../../hooks/use-project-issues";
import { useProjectMilestones } from "../../hooks/use-project-milestones";
import { useProjectChangeRequests } from "../../hooks/use-project-change-requests";
import { IssuesPanel } from "./issues-panel";
import { MilestonesPanel } from "./milestones-panel";
import { ChangeRequestsPanel, type ChangeRequestPrefill } from "./change-requests-panel";
import type { ProjectIssue } from "@/types/database";

interface DeliveryTabProps {
  projectId: string;
  onProjectChanged: () => void;
}

export function DeliveryTab({ projectId, onProjectChanged }: DeliveryTabProps) {
  const issuesState = useProjectIssues(projectId);
  const milestonesState = useProjectMilestones(projectId);
  const changeRequestsState = useProjectChangeRequests(projectId);
  const [crPrefill, setCrPrefill] = useState<ChangeRequestPrefill | null>(null);

  function handlePromoteToChangeRequest(issue: ProjectIssue) {
    setCrPrefill({ title: `Scope change: ${issue.title}`, originIssueId: issue.id });
  }

  async function handleAcceptMilestone(id: string) {
    const ok = await milestonesState.acceptMilestone(id);
    if (ok) onProjectChanged();
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <IssuesPanel
        issues={issuesState.issues}
        loading={issuesState.loading}
        onCreate={issuesState.createIssue}
        onResolve={(id) => issuesState.updateIssue(id, { status: "resolved" })}
        onPromoteToChangeRequest={handlePromoteToChangeRequest}
      />
      <MilestonesPanel
        milestones={milestonesState.milestones}
        loading={milestonesState.loading}
        onCreate={milestonesState.createMilestone}
        onAccept={handleAcceptMilestone}
        onReject={(id) => milestonesState.rejectMilestone(id)}
      />
      <div className="md:col-span-2">
        <ChangeRequestsPanel
          changeRequests={changeRequestsState.changeRequests}
          loading={changeRequestsState.loading}
          prefill={crPrefill}
          onPrefillConsumed={() => setCrPrefill(null)}
          onCreate={changeRequestsState.createChangeRequest}
          onApprove={handleApproveCr}
          onReject={handleRejectCr}
        />
      </div>
    </div>
  );
}
