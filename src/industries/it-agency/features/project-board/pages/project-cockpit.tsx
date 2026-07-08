"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useProjectCockpit } from "../hooks/use-project-cockpit";
import { HealthBanner } from "../components/cockpit/health-banner";
import { BriefEditor } from "../components/cockpit/brief-editor";
import { QualifyPanel } from "../components/cockpit/qualify-panel";
import { DeliveryTab } from "../components/cockpit/delivery-tab";
import { ReportsTab } from "../components/cockpit/reports-tab";
import { TimelinePanel } from "../components/cockpit/timeline-panel";
import { StatusPill } from "../components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectStatus } from "@/types/database";

interface ProjectCockpitPageProps {
  projectId: string;
}

export function ProjectCockpitPage({ projectId }: ProjectCockpitPageProps) {
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
    <div className="flex flex-col gap-4 max-w-4xl">
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

      <HealthBanner project={project} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="reports">Reconciliation &amp; Reports</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-4 mt-4">
          <BriefEditor project={project} onSave={(brief) => updateProject({ brief })} />
          <QualifyPanel project={project} onQualify={qualifyProject} />
        </TabsContent>
        <TabsContent value="delivery" className="mt-4">
          <DeliveryTab projectId={projectId} onProjectChanged={refetch} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab projectId={projectId} onEventRecorded={refetchEvents} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <TimelinePanel events={events} loading={loading} onAddRetroLesson={addRetroLesson} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
