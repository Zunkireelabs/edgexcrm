"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TodayWorklist } from "./today-worklist";
import { SequencesManager } from "./sequences-manager";
import { EnrollmentsTable } from "./enrollments-table";
import { Button } from "@/components/ui/button";
import { OUTREACH_CHANNELS, CHANNEL_LABEL, type OutreachChannel } from "../lib/channel";
import type { UserRole } from "@/types/database";

interface OutreachCockpitProps {
  role: UserRole;
  currentUserId: string;
  industryId: string | null;
}

export function OutreachCockpit({ role, currentUserId, industryId }: OutreachCockpitProps) {
  const isAdmin = role === "owner" || role === "admin";
  // Email and SMS are separate channels (different content, limits, cost and compliance): everything below follows the pick.
  const [channel, setChannel] = useState<OutreachChannel>("email");

  return (
    <div className="flex flex-col h-[calc(100vh-90px)] gap-4">
      <div>
        <h1 className="text-xl font-bold">Outreach</h1>
        <p className="text-sm text-muted-foreground">
          Sequenced follow-ups — reviewed and sent by your team, or sent automatically via EdgeX.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit" role="group" aria-label="Channel">
        {OUTREACH_CHANNELS.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={channel === c ? "default" : "ghost"}
            aria-pressed={channel === c}
            onClick={() => setChannel(c)}
          >
            {CHANNEL_LABEL[c]}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="today" className="flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="min-h-0">
          <TodayWorklist isAdmin={isAdmin} channel={channel} />
        </TabsContent>

        <TabsContent value="sequences" className="min-h-0">
          <SequencesManager isAdmin={isAdmin} industryId={industryId} channel={channel} />
        </TabsContent>

        <TabsContent value="enrollments" className="min-h-0">
          <EnrollmentsTable isAdmin={isAdmin} currentUserId={currentUserId} channel={channel} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
