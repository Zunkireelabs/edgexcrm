"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardBuilderDialog } from "../components/dashboard-builder-dialog";

export function DashboardsEmpty({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreated(id: string) {
    setDialogOpen(false);
    router.push(`/insights/dashboards/${id}`);
  }

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-gray-500">
          No dashboards have been assigned to your position yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-gray-500 mb-4">No dashboards yet — create one to get started.</p>
      <Button onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New Dashboard
      </Button>
      <DashboardBuilderDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
