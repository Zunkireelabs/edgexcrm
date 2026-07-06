"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MyAttendancePanel } from "./my-attendance-panel";
import { TeamAttendancePanel } from "./team-attendance-panel";

interface AttendanceWorkspaceProps {
  canManageHR: boolean;
  isManager: boolean;
}

export function AttendanceWorkspace({ canManageHR, isManager }: AttendanceWorkspaceProps) {
  const showTeamTab = canManageHR || isManager;

  if (!showTeamTab) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <MyAttendancePanel />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Tabs defaultValue="mine">
        <TabsList className="mb-4">
          <TabsTrigger value="mine">My Attendance</TabsTrigger>
          <TabsTrigger value="team">Team Attendance</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          <MyAttendancePanel />
        </TabsContent>
        <TabsContent value="team">
          <TeamAttendancePanel canManageHR={canManageHR} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
