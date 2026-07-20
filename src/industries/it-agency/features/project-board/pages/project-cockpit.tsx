"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useProjectCockpit } from "../hooks/use-project-cockpit";
import { HealthBanner } from "../components/cockpit/health-banner";
import { BriefEditor } from "../components/cockpit/brief-editor";
import { QualifyPanel } from "../components/cockpit/qualify-panel";
import { BillableSummary } from "../components/cockpit/billable-summary";
import { InvoicesPanel } from "../components/cockpit/invoices-panel";
import { ContactsSection } from "../components/cockpit/contacts-section";
import { TasksSection } from "../components/cockpit/tasks-section";
import { TasksSummaryCard } from "../components/cockpit/tasks-summary-card";
import { DeliveryTab } from "../components/cockpit/delivery-tab";
import { ReportsTab } from "../components/cockpit/reports-tab";
import { TimelinePanel } from "../components/cockpit/timeline-panel";
import { AiSummaryCard } from "../components/cockpit/ai-summary-card";
import { StatusPill } from "../components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AI_SYNTH_PREVIEW } from "../lib/ai-preview";
import { ActiveTimersProvider } from "@/industries/it-agency/features/time-tracking/hooks/use-active-timers";
import type { ProjectStatus } from "@/types/database";

interface ProjectCockpitPageProps {
  projectId: string;
  role: string;
  // Tenant slug, for the AI-synth vision-preview flag (lib/ai-preview.ts).
  tenantSlug: string | null;
}

export function ProjectCockpitPage({ projectId, role, tenantSlug }: ProjectCockpitPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const aiPreviewEnabled = AI_SYNTH_PREVIEW.enabledFor(tenantSlug, isAdmin);
  const [activeTab, setActiveTab] = useState("overview");
  const {
    project,
    events,
    accountName,
    ownerEmail,
    loading,
    refetch,
    refetchEvents,
    updateProject,
    qualifyProject,
    addRetroLesson,
  } = useProjectCockpit(projectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground text-sm">
        <p>Project not found.</p>
        <Link href="/projects" className="text-primary hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Projects
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
          <StatusPill status={project.status as ProjectStatus} />
        </div>
        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
          {accountName && <span>{accountName}</span>}
          {project.engagement_model && <span>· {project.engagement_model.replace("_", " ")}</span>}
          {ownerEmail && <span>· Owner: {ownerEmail}</span>}
          {project.target_end_date && <span>· Due {project.target_end_date}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="min-w-0">
          <HealthBanner project={project} />
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="delivery">Delivery</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="reports">Reconciliation &amp; Reports</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="flex flex-col gap-4 mt-4">
              {aiPreviewEnabled && <AiSummaryCard />}
              <BriefEditor project={project} isAdmin={isAdmin} onSave={(brief) => updateProject({ brief })} />
              <QualifyPanel project={project} isAdmin={isAdmin} onQualify={qualifyProject} />
              <TasksSummaryCard projectId={projectId} onViewAllTasks={() => setActiveTab("tasks")} />
            </TabsContent>
            <TabsContent value="delivery" className="mt-4">
              <DeliveryTab
                projectId={projectId}
                isAdmin={isAdmin}
                onProjectChanged={refetch}
                onEventRecorded={refetchEvents}
              />
            </TabsContent>
            <TabsContent value="tasks" className="mt-4">
              <ActiveTimersProvider>
                <TasksSection projectId={projectId} isAdmin={isAdmin} />
              </ActiveTimersProvider>
            </TabsContent>
            <TabsContent value="reports" className="mt-4">
              <ReportsTab
                projectId={projectId}
                isAdmin={isAdmin}
                onEventRecorded={refetchEvents}
                project={project}
                events={events}
                aiPreviewEnabled={aiPreviewEnabled}
              />
            </TabsContent>
            <TabsContent value="timeline" className="mt-4">
              <TimelinePanel events={events} loading={loading} isAdmin={isAdmin} onAddRetroLesson={addRetroLesson} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          {project.is_billable && <BillableSummary projectId={projectId} isAdmin={isAdmin} />}
          {isAdmin && project.is_billable && (
            <InvoicesPanel projectId={projectId} currency={project.currency ?? "NPR"} />
          )}
          <ContactsSection projectId={projectId} accountId={project.account_id} isAdmin={isAdmin} />
        </aside>
      </div>
    </div>
  );
}
