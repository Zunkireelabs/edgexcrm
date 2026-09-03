"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { GreetingHeader } from "./greeting-header";
import { ScheduleCard } from "./schedule-card";
import { ScheduleTabContent } from "./schedule-tab-content";
import { TasksTabContent } from "./tasks-tab-content";
import { TasksCard } from "./tasks-card";
import { MyLeadsCard } from "./my-leads-card";
import { InboxSnapshotCard } from "./inbox-snapshot-card";
import { RecentActivityCard } from "./recent-activity-card";
import { DayGlanceRail } from "./day-glance-rail";
import { LayoutGrid, Grip } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toLocalDateString } from "@/lib/date";
import type { ScheduleActivity, PersonalTask, MyTasksResult, InboxSnapshot, RecentActivityItem, LeaveHomeSummary } from "@/lib/supabase/queries";
import type { HomeTip } from "@/lib/home/tips";
import type { Lead, TaskStatus } from "@/types/database";

// Same _shared -> it_agency coupling trade-off as dashboard-renderer.tsx: dynamic
// import keeps non-it_agency Home bundles from growing.
const MyUtilizationWidget = dynamic(
  () => import("@/industries/it-agency/features/delivery-dashboard/widgets/my-utilization")
);
const MyTimeWidget = dynamic(
  () => import("@/industries/it-agency/features/delivery-dashboard/widgets/my-time")
);

const HOME_TABS = [
  { value: "overview", label: "Overview" },
  { value: "schedule", label: "Schedule" },
  { value: "tasks", label: "Tasks" },
  { value: "activities", label: "Activities" },
] as const;

interface HomeContentProps {
  userId: string;
  userName: string;
  schedule: ScheduleActivity[];
  tasks: MyTasksResult;
  myLeads: Lead[];
  recentActivity: RecentActivityItem[];
  inboxSnapshot: InboxSnapshot;
  isEducation: boolean;
  isItAgency: boolean;
  applicationTrackingEnabled: boolean;
  currentTenantUserId: string | null;
  leaveSummary: LeaveHomeSummary;
  outreachDue: number;
  tip: HomeTip;
}

const ACTIVITY_FILTERS: { key: string; label: string; match: (type: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "lead", label: "Leads", match: (t) => t === "lead" },
  { key: "application", label: "Applications", match: (t) => t === "application" },
  { key: "task", label: "Tasks", match: (t) => t === "task" },
  { key: "other", label: "Other", match: (t) => !["lead", "application", "task"].includes(t) },
];

export function HomeContent({
  userId,
  userName,
  schedule,
  tasks,
  myLeads,
  recentActivity,
  inboxSnapshot,
  isItAgency,
  applicationTrackingEnabled,
  currentTenantUserId,
  tip,
}: HomeContentProps) {
  const router = useRouter();
  const [openTasks, setOpenTasks] = useState<PersonalTask[]>(tasks.open);
  const [doneTasks, setDoneTasks] = useState<PersonalTask[]>(tasks.done);
  const [activeTab, setActiveTab] = useState("overview");
  const [activityFilter, setActivityFilter] = useState("all");

  const handleComplete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (res.ok) {
      const task = openTasks.find((t) => t.id === id);
      if (task) {
        setOpenTasks((prev) => prev.filter((t) => t.id !== id));
        setDoneTasks((prev) => [{ ...task, status: "done" as TaskStatus }, ...prev].slice(0, 10));
      }
      router.refresh();
    }
  }, [openTasks, router]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setOpenTasks((prev) => prev.filter((t) => t.id !== id));
      setDoneTasks((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    }
  }, [router]);

  const handleCreated = useCallback((task: Record<string, unknown>) => {
    // Only surface it here if it's actually assigned to me — assigning a task to
    // someone else from Home shouldn't add it to MY open-tasks list.
    if (task.assignee_id === userId) {
      setOpenTasks((prev) => [task as unknown as PersonalTask, ...prev]);
    }
    router.refresh();
  }, [router, userId]);

  const today = toLocalDateString(new Date());
  const now = new Date().toISOString();
  const meetingsCount = schedule.filter((a) => a.scheduled_at >= now).length;
  const tasksDueTodayCount = openTasks.filter((t) => t.due_date === today).length;

  const filteredActivity = useMemo(
    () => recentActivity.filter((a) => ACTIVITY_FILTERS.find((f) => f.key === activityFilter)?.match(a.entity_type) ?? true),
    [recentActivity, activityFilter],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-0 items-start">
      <div className="min-w-0 w-full lg:flex-1 space-y-3 lg:pr-6">
        <GreetingHeader userName={userName} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="border-b border-border w-full justify-start">
            {HOME_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="group flex-none rounded-[8px] gap-1.5 hover:bg-muted data-[state=active]:bg-sidebar! data-[state=active]:shadow-none data-[state=active]:after:opacity-0!"
              >
                <span className="relative inline-flex h-3.5 w-3.5 shrink-0">
                  <LayoutGrid className="absolute inset-0 h-3.5 w-3.5 transition-opacity group-hover:opacity-0" />
                  <Grip className="absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-4">
            {isItAgency && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">My Work</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <MyUtilizationWidget currentUserId={userId} currentTenantUserId={currentTenantUserId} />
                  <MyTimeWidget currentUserId={userId} currentTenantUserId={currentTenantUserId} />
                </div>
              </div>
            )}

            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ScheduleCard schedule={schedule} />
                <TasksCard
                  initialOpen={openTasks}
                  initialDone={doneTasks}
                  currentUserId={userId}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  onCreated={handleCreated}
                />
              </div>
            </div>

            <div>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Leads &amp; Messages</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MyLeadsCard leads={myLeads} />
                <InboxSnapshotCard snapshot={inboxSnapshot} />
              </div>
            </div>

            <RecentActivityCard
              notifications={recentActivity.slice(0, 6)}
              onViewAll={recentActivity.length > 6 ? () => setActiveTab("activities") : undefined}
            />
          </TabsContent>

          <TabsContent value="schedule" className="mt-4">
            <ScheduleTabContent schedule={schedule} />
          </TabsContent>

          <TabsContent value="tasks" className="mt-4">
            <TasksTabContent
              initialOpen={openTasks}
              initialDone={doneTasks}
              currentUserId={userId}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onCreated={handleCreated}
            />
          </TabsContent>

          <TabsContent value="activities" className="mt-4 space-y-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {ACTIVITY_FILTERS.map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={activityFilter === f.key ? "default" : "outline"}
                  className={cn("h-7 px-2.5 text-xs", activityFilter === f.key && "pointer-events-none")}
                  onClick={() => setActivityFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <RecentActivityCard notifications={filteredActivity} />
          </TabsContent>
        </Tabs>
      </div>

      <DayGlanceRail
        className="lg:w-[300px]"
        meetingsCount={meetingsCount}
        tasksDueTodayCount={tasksDueTodayCount}
        activitiesCount={recentActivity.length}
        unreadCount={inboxSnapshot.unreadCount}
        applicationTrackingEnabled={applicationTrackingEnabled}
        tip={tip}
        onNewTaskClick={() => setActiveTab("tasks")}
      />
    </div>
  );
}
