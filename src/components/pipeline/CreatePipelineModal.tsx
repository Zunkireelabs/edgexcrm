"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { PipelineWithCounts } from "@/types/database";

interface CreatePipelineModalProps {
  open: boolean;
  onClose: (newPipelineId?: string) => void;
  pipelines: PipelineWithCounts[];
  tenantId: string;
}

type TemplateType = "default" | "copy" | "empty";

export function CreatePipelineModal({
  open,
  onClose,
  pipelines,
}: CreatePipelineModalProps) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TemplateType>("default");
  const [copyFromId, setCopyFromId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Pipeline name is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        template,
      };

      if (template === "copy" && copyFromId) {
        payload.copy_from_id = copyFromId;
      }

      const res = await fetch("/api/v1/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to create pipeline");
      }

      toast.success(`Pipeline "${name}" created`);
      setName("");
      setTemplate("default");
      setCopyFromId("");
      onClose(json.data?.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create pipeline");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName("");
    setTemplate("default");
    setCopyFromId("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Pipeline</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Pipeline Name */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-name">Pipeline Name</Label>
            <Input
              id="pipeline-name"
              placeholder="e.g., Sales Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Template Selection */}
          <div className="space-y-2">
            <Label>Start with</Label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="template"
                  value="default"
                  checked={template === "default"}
                  onChange={() => setTemplate("default")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">Default stages</div>
                  <div className="text-xs text-muted-foreground">
                    New, Contacted, Won, Lost
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="template"
                  value="copy"
                  checked={template === "copy"}
                  onChange={() => setTemplate("copy")}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Copy from existing</div>
                  <div className="text-xs text-muted-foreground mb-2">
                    Duplicate stages from another pipeline
                  </div>
                  {template === "copy" && (
                    <Select value={copyFromId} onValueChange={setCopyFromId}>
                      <SelectTrigger className="w-full h-8 text-sm">
                        <SelectValue placeholder="Select pipeline to copy" />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.stage_count} stages)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="template"
                  value="empty"
                  checked={template === "empty"}
                  onChange={() => setTemplate("empty")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">Empty pipeline</div>
                  <div className="text-xs text-muted-foreground">
                    Start with no stages, add them manually
                  </div>
                </div>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
