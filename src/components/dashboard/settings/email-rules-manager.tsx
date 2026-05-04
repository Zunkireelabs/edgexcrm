"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Mail,
  Plus,
  Pencil,
  Trash2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { EmailForwardRule } from "@/types/database";

interface PipelineOption {
  id: string;
  name: string;
}

interface StageOption {
  id: string;
  name: string;
  color: string;
}

interface RuleFormData {
  name: string;
  is_active: boolean;
  from_name: string;
  pipeline_id: string;
  stage_id: string;
  subject: string;
  body: string;
}

const DEFAULT_FORM: RuleFormData = {
  name: "",
  is_active: true,
  from_name: "",
  pipeline_id: "",
  stage_id: "",
  subject: "",
  body: "",
};

const PLACEHOLDERS = [
  { key: "{{first_name}}", label: "First Name" },
  { key: "{{last_name}}", label: "Last Name" },
  { key: "{{email}}", label: "Email" },
  { key: "{{phone}}", label: "Phone" },
  { key: "{{pipeline_name}}", label: "Pipeline" },
  { key: "{{stage_name}}", label: "Stage" },
  { key: "{{tenant_name}}", label: "Organization" },
];

export function EmailRulesManager({ }: { tenantId: string }) {
  const [rules, setRules] = useState<EmailForwardRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EmailForwardRule | null>(null);
  const [form, setForm] = useState<RuleFormData>(DEFAULT_FORM);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchRules = async () => {
    try {
      const res = await fetch("/api/v1/settings/email-rules");
      const json = await res.json();
      setRules(json.data || []);
    } catch {
      toast.error("Failed to load email rules");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  // Fetch pipelines when dialog opens
  useEffect(() => {
    if (!dialogOpen) return;
    fetch("/api/v1/pipelines")
      .then((res) => res.json())
      .then((json) => setPipelines(json.data || []))
      .catch(() => {});
  }, [dialogOpen]);

  // Fetch stages when pipeline changes
  useEffect(() => {
    if (!form.pipeline_id) {
      setStages([]);
      return;
    }
    fetch(`/api/v1/pipelines/${form.pipeline_id}`)
      .then((res) => res.json())
      .then((json) => setStages(json.data?.stages || []))
      .catch(() => {});
  }, [form.pipeline_id]);

  const openAddDialog = () => {
    setEditingRule(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: EmailForwardRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      is_active: rule.is_active,
      from_name: rule.from_name || "",
      pipeline_id: rule.pipeline_id,
      stage_id: rule.stage_id,
      subject: rule.subject,
      body: rule.body,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.pipeline_id || !form.stage_id || !form.subject || !form.body) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingRule
        ? `/api/v1/settings/email-rules/${editingRule.id}`
        : "/api/v1/settings/email-rules";

      const res = await fetch(url, {
        method: editingRule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to save");
      }

      toast.success(editingRule ? "Rule updated" : "Rule created");
      setDialogOpen(false);
      fetchRules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save rule");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (rule: EmailForwardRule) => {
    try {
      const res = await fetch(`/api/v1/settings/email-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      if (!res.ok) throw new Error();
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, is_active: !r.is_active } : r
        )
      );
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/settings/email-rules/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Rule deleted");
      setDeleteConfirm(null);
      fetchRules();
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const handleTestEmail = async () => {
    if (!editingRule || !testEmail) {
      toast.error("Enter a test email address");
      return;
    }
    setIsTesting(true);
    try {
      const res = await fetch(
        `/api/v1/settings/email-rules/${editingRule.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test_email: testEmail }),
        }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Test failed");
      }
      toast.success(`Test email sent to ${testEmail}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test email failed");
    } finally {
      setIsTesting(false);
    }
  };

  const insertPlaceholder = (key: string) => {
    setForm((prev) => ({ ...prev, body: prev.body + key }));
  };

  return (
    <>
      {/* Email Auto-Forward Rules */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" />
              Email Auto-Forward Rules
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Automatically send emails to leads when they enter specific pipeline stages.
            </p>
          </div>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-1" />
            Add Rule
          </Button>
        </div>

        <div className="border-t">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No email rules configured yet. Click &quot;Add Rule&quot; to get started.
            </div>
          ) : (
            <div className="divide-y">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={rule.is_active}
                    onCheckedChange={() => handleToggle(rule)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {rule.name}
                      </span>
                      {rule.stage_color && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: rule.stage_color }}
                          />
                          {rule.pipeline_name} → {rule.stage_name}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      Subject: {rule.subject}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(rule)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteConfirm(rule.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "Edit Email Rule" : "Add Email Rule"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1">
            {/* Rule Name + Active Toggle */}
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label>Rule Name</Label>
                <Input
                  placeholder='e.g., "Welcome Email"'
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(checked: boolean) =>
                    setForm((f) => ({ ...f, is_active: !!checked }))
                  }
                />
                <Label className="text-sm font-normal">Active</Label>
              </div>
            </div>

            {/* From Name (optional) */}
            <div className="space-y-2">
              <Label>
                From Name{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                placeholder='e.g., "Admizz Education" (defaults to Lead Gen CRM)'
                value={form.from_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, from_name: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                The display name shown in the &quot;From&quot; field of the email.
              </p>
            </div>

            {/* Pipeline + Stage */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select
                  value={form.pipeline_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, pipeline_id: v, stage_id: "" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trigger Stage</Label>
                <Select
                  value={form.stage_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, stage_id: v }))
                  }
                  disabled={!form.pipeline_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Email will be sent to the lead when they move into the selected stage.
            </p>

            {/* Subject */}
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder='e.g., "Welcome {{first_name}}!"'
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
              />
            </div>

            {/* Body */}
            <div className="space-y-2">
              <Label>Email Body (HTML)</Label>
              <textarea
                className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                placeholder="Write your email content here. You can use HTML and placeholders."
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
              />
            </div>

            {/* Placeholder Chips */}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Click to insert a placeholder:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => insertPlaceholder(p.key)}
                    className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors font-mono"
                  >
                    {p.key}
                  </button>
                ))}
              </div>
            </div>

            {/* Test Email (only for existing rules) */}
            {editingRule && (
              <div className="rounded-lg border p-4 space-y-3">
                <Label>Send Test Email</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestEmail}
                    disabled={isTesting || !testEmail}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {isTesting ? "Sending..." : "Test"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : editingRule
                ? "Save Changes"
                : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Rule Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Email Rule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure? This rule will stop sending emails to leads.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
