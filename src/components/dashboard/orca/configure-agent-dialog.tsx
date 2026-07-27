"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AgentDetail, AgentToolPolicyItem } from "@/lib/ai/agents/queries";

interface ConfigureAgentDialogProps {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// doc-04 §3's three-rung ladder — copy matches BRIEF-PHASE-5-4D-APPROVAL-UX-AND-MATRIX.md's table verbatim.
const LEVEL_COPY: Record<AgentToolPolicyItem["automationLevel"], { label: string; copy: string }> = {
  human_led: { label: "Draft only", copy: "The agent proposes; nothing changes until a person does it themselves." },
  agent_human: {
    label: "Needs approval",
    copy: "The agent prepares the action and it runs only after you approve it — under your own permissions.",
  },
  fully_automated: {
    label: "Fully automatic",
    copy: "Not available yet — requires agent actor attribution and prompt-injection containment.",
  },
};

/**
 * The Configure dialog behind the fleet card's Settings2 button
 * (agents-content.tsx) — 5.4d Part 5, the per-agent x per-write-tool
 * automation matrix. Reads GET /api/v1/agent-identities/[id] (already
 * admin-only, tenant-scoped — same fetch AgentDetailDrawer makes) and writes
 * through PATCH .../tool-policies, one row at a time.
 */
export function ConfigureAgentDialog({ agentId, open, onOpenChange }: ConfigureAgentDialogProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingToolId, setSavingToolId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    (async () => {
      try {
        const res = await fetch(`/api/v1/agent-identities/${agentId}`);
        if (!res.ok) throw new Error("Failed to load agent detail");
        const body = await res.json();
        if (!cancelled) setDetail(body.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load agent detail");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agentId]);

  async function updateLevel(toolId: string, automationLevel: string) {
    if (!agentId || !detail) return;
    const previousPolicies = detail.toolPolicies;
    setSavingToolId(toolId);
    setDetail({
      ...detail,
      toolPolicies: detail.toolPolicies.map((p) =>
        p.toolId === toolId ? { ...p, automationLevel: automationLevel as AgentToolPolicyItem["automationLevel"] } : p,
      ),
    });
    try {
      const res = await fetch(`/api/v1/agent-identities/${agentId}/tool-policies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId, automationLevel }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update automation level");
      }
      toast.success("Automation level updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update automation level");
      setDetail((d) => (d ? { ...d, toolPolicies: previousPolicies } : d));
    } finally {
      setSavingToolId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure automation</DialogTitle>
          <DialogDescription>{detail ? `${detail.displayName} — per-action automation level` : " "}</DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {detail && detail.toolPolicies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This agent has no write actions to configure — it only drafts suggestions today.
          </p>
        )}

        {detail && detail.toolPolicies.length > 0 && (
          <div className="space-y-4">
            {detail.toolPolicies.map((policy) => (
              <div key={policy.toolId} className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-900">
                  {policy.label.charAt(0).toUpperCase() + policy.label.slice(1)}
                </Label>
                <Select
                  value={policy.automationLevel}
                  disabled={savingToolId === policy.toolId}
                  onValueChange={(value) => updateLevel(policy.toolId, value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="human_led">{LEVEL_COPY.human_led.label}</SelectItem>
                    <SelectItem value="agent_human">{LEVEL_COPY.agent_human.label}</SelectItem>
                    {/* Rendered disabled and visible, not hidden — an admin should see the top rung exists and why it's unavailable, not be left thinking the ladder only has two rungs. */}
                    <SelectItem value="fully_automated" disabled>
                      {LEVEL_COPY.fully_automated.label}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">{LEVEL_COPY[policy.automationLevel]?.copy}</p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
