"use client";

import { useState } from "react";
import { Plus, CheckCircle2, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IssueKind, IssueSeverity, ProjectIssue } from "@/types/database";

const SEVERITY_DOT: Record<IssueSeverity, string> = {
  low: "bg-slate-400",
  medium: "bg-amber-500",
  high: "bg-red-500",
};

const KIND_LABEL: Record<IssueKind, string> = {
  query: "Query",
  issue: "Issue",
  blocker: "Blocker",
};

function slaAge(openedAt: string, resolvedAt: string | null): string {
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const hours = Math.max(0, Math.round((end - new Date(openedAt).getTime()) / 3_600_000));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

interface IssuesPanelProps {
  issues: ProjectIssue[];
  loading: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onResolve: (issueId: string) => Promise<boolean>;
  onPromoteToChangeRequest: (issue: ProjectIssue) => void;
}

export function IssuesPanel({ issues, loading, onCreate, onResolve, onPromoteToChangeRequest }: IssuesPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<IssueKind>("query");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [raisedByLabel, setRaisedByLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setSubmitting(true);
    const ok = await onCreate({
      title: title.trim(),
      kind,
      severity,
      raised_by_label: raisedByLabel.trim() || undefined,
      source: raisedByLabel.trim() ? "client" : "internal",
    });
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setRaisedByLabel("");
      setAdding(false);
    }
  }

  const openIssues = issues.filter((i) => i.status !== "resolved" && i.status !== "closed");
  const closedIssues = issues.filter((i) => i.status === "resolved" || i.status === "closed");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Client queries &amp; issues</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Raise
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <Input placeholder="What's the query or issue?" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-2 flex-wrap">
              <Select value={kind} onValueChange={(v) => setKind(v as IssueKind)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as IssueKind[]).map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={severity} onValueChange={(v) => setSeverity(v as IssueSeverity)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="flex-1 min-w-32"
                placeholder="Raised by (optional, e.g. client name)"
                value={raisedByLabel}
                onChange={(e) => setRaisedByLabel(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={submitting || title.trim().length === 0}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!loading && issues.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground italic">No queries or issues raised yet.</p>
        )}

        {openIssues.map((issue) => (
          <div key={issue.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="flex items-start gap-2 min-w-0">
              <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[issue.severity]}`} />
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{issue.title}</p>
                <p className="text-xs text-muted-foreground">
                  {KIND_LABEL[issue.kind]} · open {slaAge(issue.opened_at, null)}
                  {issue.raised_by_label && ` · ${issue.raised_by_label}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => onPromoteToChangeRequest(issue)} title="Promote to change request">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onResolve(issue.id)} title="Resolve">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}

        {closedIssues.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Resolved ({closedIssues.length})</summary>
            <div className="mt-2 space-y-1.5">
              {closedIssues.map((issue) => (
                <div key={issue.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="truncate">{issue.title}</span>
                  <span className="text-muted-foreground/70 flex-shrink-0">
                    ({slaAge(issue.opened_at, issue.resolved_at)})
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
