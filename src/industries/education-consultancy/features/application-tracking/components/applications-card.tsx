"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";
import { AddApplicationToLeadSheet } from "./add-application-to-lead-sheet";
import type { Application, ApplicationStage } from "@/types/database";

interface ApplicationsCardProps {
  leadId: string;
  canManage: boolean;
}

export function ApplicationsCard({ leadId, canManage }: ApplicationsCardProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stages, setStages] = useState<ApplicationStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/applications`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setApplications(data ?? []);
    } catch {
      // silently fail — card stays empty
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchApplications(),
      fetch("/api/v1/application-stages")
        .then((r) => r.json())
        .then((j) => setStages(j.data ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [fetchApplications]);

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              Applications
              {!loading && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                  {applications.length}
                </Badge>
              )}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setAddOpen(true)}
                title="Add Application"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : applications.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No applications yet.</p>
          ) : (
            <div className="space-y-0.5">
              {applications.map((app) => {
                const stage =
                  (app.application_stages as ApplicationStage | null) ??
                  stages.find((s) => s.id === app.stage_id) ??
                  null;
                return (
                  <Link
                    key={app.id}
                    href={`/applications/${app.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm font-medium truncate min-w-0">
                      {app.university_name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {app.intake_term && (
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {app.intake_term}
                        </span>
                      )}
                      {stage && (
                        <StatusBadge
                          slug={stage.slug}
                          name={stage.name}
                          color={stage.color}
                          terminalType={stage.terminal_type}
                        />
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AddApplicationToLeadSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        leadId={leadId}
        stages={stages}
        onSuccess={() => {
          setAddOpen(false);
          fetchApplications();
        }}
      />
    </>
  );
}
