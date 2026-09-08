"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectIssues } from "../../hooks/use-project-issues";
import { useProjectMilestones } from "../../hooks/use-project-milestones";
import { useProjectChangeRequests } from "../../hooks/use-project-change-requests";
import { useProjectRisks } from "../../hooks/use-project-risks";
import { IssuesPanel } from "./issues-panel";
import { MilestonesPanel } from "./milestones-panel";
import { ChangeRequestsPanel, type ChangeRequestPrefill } from "./change-requests-panel";
import { RisksPanel } from "./risks-panel";
import type { ProjectIssue } from "@/types/database";
import type { TeamMember } from "../../hooks/use-projects";

type DeliveryKind = "milestone" | "issue" | "risk" | "change";

interface DeliveryTabProps {
  projectId: string;
  canManageProjects: boolean;
  /** Project currency, threaded from the cockpit — milestone amounts render in it. */
  currency?: string | null;
  onProjectChanged: () => void;
  onEventRecorded: () => void;
}

export function DeliveryTab({ projectId, canManageProjects, currency, onProjectChanged, onEventRecorded }: DeliveryTabProps) {
  const issuesState = useProjectIssues(projectId);
  const milestonesState = useProjectMilestones(projectId);
  const changeRequestsState = useProjectChangeRequests(projectId);
  const risksState = useProjectRisks(projectId);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [crPrefill, setCrPrefill] = useState<ChangeRequestPrefill | null>(null);
  const [committingPlan, setCommittingPlan] = useState(false);
  // Panels the user explicitly asked to add to, from the empty state or the
  // tab-header "Add" control. Never hides an existing panel — only re-reveals
  // an empty one so its (unchanged) create form can be opened.
  const [pendingAdd, setPendingAdd] = useState<Set<DeliveryKind>>(new Set());

  function requestAdd(kind: DeliveryKind) {
    setPendingAdd((prev) => new Set(prev).add(kind));
  }

  useEffect(() => {
    fetch("/api/v1/team?minimal=1")
      .then((r) => r.json())
      .then((json) => setTeam(json.data ?? []))
      .catch(() => toast.error("Failed to load team"));
  }, []);

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
    // Pin the panel open first: Phase 6 unmounts empty panels, and prefill
    // consumption nulls crPrefill on the same tick the panel mounts — without a
    // pendingAdd entry the panel (and the prefilled form) unmounts again.
    requestAdd("change");
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

  async function handleCreateRisk(payload: Record<string, unknown>) {
    const ok = await risksState.createRisk(payload);
    if (ok) onEventRecorded();
    return ok;
  }

  async function handleUpdateRisk(id: string, patch: Record<string, unknown>) {
    const ok = await risksState.updateRisk(id, patch);
    if (ok) onEventRecorded();
    return ok;
  }

  const anyLoading =
    issuesState.loading || milestonesState.loading || changeRequestsState.loading || risksState.loading;
  const counts: Record<DeliveryKind, number> = {
    milestone: milestonesState.milestones.length,
    issue: issuesState.issues.length,
    risk: risksState.risks.length,
    change: changeRequestsState.changeRequests.length,
  };
  const allEmpty = !anyLoading && pendingAdd.size === 0 && Object.values(counts).every((n) => n === 0);
  // A CR promoted from an issue must always surface its panel.
  const showChangePanel = counts.change > 0 || pendingAdd.has("change") || crPrefill != null;
  const showMilestones = counts.milestone > 0 || pendingAdd.has("milestone");
  const showIssues = counts.issue > 0 || pendingAdd.has("issue");
  const showRisks = counts.risk > 0 || pendingAdd.has("risk");

  const commitPlanButton = canManageProjects && (
    <Button variant="outline" size="sm" onClick={handleCommitPlan} disabled={committingPlan}>
      {committingPlan ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
      )}
      Commit plan
    </Button>
  );

  const ADD_LABELS: Record<DeliveryKind, string> = {
    milestone: "Add milestone",
    issue: "Log issue",
    risk: "Raise risk",
    change: "Request change",
  };

  if (anyLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allEmpty) {
    return (
      <div className="flex flex-col gap-4">
        {canManageProjects && <div className="flex items-center justify-end">{commitPlanButton}</div>}
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No delivery records yet. Add one when the project needs it.
          </p>
          {canManageProjects && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {(Object.keys(ADD_LABELS) as DeliveryKind[]).map((kind) => (
                <Button key={kind} variant="outline" size="sm" onClick={() => requestAdd(kind)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {ADD_LABELS[kind]}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hiddenKinds = (Object.keys(ADD_LABELS) as DeliveryKind[]).filter((kind) => {
    if (kind === "milestone") return !showMilestones;
    if (kind === "issue") return !showIssues;
    if (kind === "risk") return !showRisks;
    return !showChangePanel;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {canManageProjects &&
            hiddenKinds.map((kind) => (
              <Button key={kind} variant="ghost" size="sm" onClick={() => requestAdd(kind)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {ADD_LABELS[kind]}
              </Button>
            ))}
        </div>
        {commitPlanButton}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {showIssues && (
          <IssuesPanel
            issues={issuesState.issues}
            loading={issuesState.loading}
            canManageProjects={canManageProjects}
            startExpanded={pendingAdd.has("issue")}
            onCreate={issuesState.createIssue}
            onResolve={(id) => issuesState.updateIssue(id, { status: "resolved" })}
            onPromoteToChangeRequest={handlePromoteToChangeRequest}
          />
        )}
        {showRisks && (
          <RisksPanel
            risks={risksState.risks}
            loading={risksState.loading}
            canManageProjects={canManageProjects}
            team={team}
            startExpanded={pendingAdd.has("risk")}
            onCreate={handleCreateRisk}
            onUpdate={handleUpdateRisk}
          />
        )}
        {showMilestones && (
          <MilestonesPanel
            milestones={milestonesState.milestones}
            loading={milestonesState.loading}
            canManageProjects={canManageProjects}
            currency={currency}
            startExpanded={pendingAdd.has("milestone")}
            onCreate={milestonesState.createMilestone}
            onAccept={handleAcceptMilestone}
            onReject={(id) => milestonesState.rejectMilestone(id)}
            onTransition={handleTransitionMilestone}
          />
        )}
        {showChangePanel && (
          <div className="md:col-span-2">
            <ChangeRequestsPanel
              changeRequests={changeRequestsState.changeRequests}
              loading={changeRequestsState.loading}
              canManageProjects={canManageProjects}
              prefill={crPrefill}
              startExpanded={pendingAdd.has("change")}
              onPrefillConsumed={() => setCrPrefill(null)}
              onCreate={changeRequestsState.createChangeRequest}
              onApprove={handleApproveCr}
              onReject={handleRejectCr}
            />
          </div>
        )}
      </div>
    </div>
  );
}
