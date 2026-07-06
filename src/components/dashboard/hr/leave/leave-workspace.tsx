"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MyLeavePanel } from "./my-leave-panel";
import { TeamLeavePanel } from "./team-leave-panel";

interface LeaveWorkspaceProps {
  canManageHR: boolean;
  isManager: boolean;
  currentUserId: string;
}

export function LeaveWorkspace({ canManageHR, isManager }: LeaveWorkspaceProps) {
  const showTeamTab = canManageHR || isManager;

  if (!showTeamTab) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <MyLeavePanel />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Tabs defaultValue="mine">
        <TabsList className="mb-4">
          <TabsTrigger value="mine">My Leave</TabsTrigger>
          <TabsTrigger value="team">Team Leave</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          <MyLeavePanel />
        </TabsContent>
        <TabsContent value="team">
          <TeamLeavePanel canManageHR={canManageHR} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
