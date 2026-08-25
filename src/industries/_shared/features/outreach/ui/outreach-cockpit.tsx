"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TodayWorklist } from "./today-worklist";
import { SequencesManager } from "./sequences-manager";
import { EnrollmentsTable } from "./enrollments-table";
import type { UserRole } from "@/types/database";

interface OutreachCockpitProps {
  role: UserRole;
  currentUserId: string;
  industryId: string | null;
}

export function OutreachCockpit({ role, currentUserId, industryId }: OutreachCockpitProps) {
  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="flex flex-col h-[calc(100vh-90px)] gap-4">
      <div>
        <h1 className="text-xl font-bold">Outreach</h1>
        <p className="text-sm text-muted-foreground">
          Sequenced follow-ups — reviewed and sent by your team, or sent automatically via EdgeX.
        </p>
      </div>

      <Tabs defaultValue="today" className="flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="min-h-0">
          <TodayWorklist isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="sequences" className="min-h-0">
          <SequencesManager isAdmin={isAdmin} industryId={industryId} />
        </TabsContent>

        <TabsContent value="enrollments" className="min-h-0">
          <EnrollmentsTable isAdmin={isAdmin} currentUserId={currentUserId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
