"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  UserPlus,
  UserCheck,
  Calendar,
  Clock,
  Download,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage, PipelineWithCounts } from "@/types/database";
import type { TeamMember } from "@/lib/supabase/queries";

interface LeadResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage_name: string | null;
  stage_color: string | null;
  pipeline_name: string | null;
  created_at: string;
}

interface CheckInRecord {
  id: string;
  lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage_name: string | null;
  stage_color: string | null;
  pipeline_name: string | null;
  checked_in_at: string;
  checked_in_by: string;
  note: string;
}

interface CheckInPageProps {
  tenantId: string;
  pipelines: PipelineWithCounts[];
  stages: PipelineStage[];
  teamMembers: TeamMember[];
}

type DateFilter = "today" | "week" | "month" | "custom";

function getDateRange(filter: DateFilter, customFrom?: string, customTo?: string) {
  const now = new Date();
  let from: string;
  let to: string = now.toISOString();

  switch (filter) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      break;
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      break;
    }
    case "month": {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      break;
    }
    case "custom": {
      from = customFrom ? new Date(customFrom).toISOString() : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      to = customTo ? `${customTo}T23:59:59.999Z` : now.toISOString();
      break;
    }
  }

  return { from, to };
}

export function CheckInPage({ tenantId, pipelines, stages, teamMembers }: CheckInPageProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  // Add lead form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check-in history state
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const filteredStages = stages.filter((s) => s.pipeline_id === pipelineId);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Set default pipeline
  useEffect(() => {
    if (pipelines.length > 0 && !pipelineId) {
      const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0];
      setPipelineId(defaultPipeline.id);
    }
  }, [pipelines, pipelineId]);

  // Set default stage when pipeline changes
  useEffect(() => {
    if (pipelineId) {
      const pipelineStages = stages.filter((s) => s.pipeline_id === pipelineId);
      const defaultStage = pipelineStages.find((s) => s.is_default) || pipelineStages[0];
      if (defaultStage) setStageId(defaultStage.id);
    }
  }, [pipelineId, stages]);

  // Fetch check-in history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { from, to } = getDateRange(dateFilter, customFrom, customTo);
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/v1/check-ins?${params}`);
      const json = await res.json();
      if (json.data) {
        setCheckIns(json.data);
      }
    } catch {
      toast.error("Failed to load check-in history");
    } finally {
      setLoadingHistory(false);
    }
  }, [dateFilter, customFrom, customTo]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Debounced search
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 3) {
      setResults([]);
      setSearched(false);
      setShowAddForm(false);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/v1/leads/check-in?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (json.data) {
        setResults(json.data);
        setSearched(true);
        setShowAddForm(json.data.length === 0);
      }
    } catch {
      toast.error("Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleCheckIn = async (leadId: string) => {
    setCheckingIn(leadId);
    try {
      await fetch(`/api/v1/leads/${leadId}/check-in`, { method: "POST" });
      toast.success("Check-in recorded");
      fetchHistory();
      setQuery("");
      setResults([]);
      setSearched(false);
      setCheckingIn(null);
    } catch {
      toast.error("Failed to check in");
      setCheckingIn(null);
    }
  };

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName && !email && !phone) {
      toast.error("Please provide at least a name, email, or phone");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          first_name: firstName || null,
          last_name: lastName || null,
          email: email || null,
          phone: phone || null,
          pipeline_id: pipelineId,
          stage_id: stageId,
          assigned_to: assignedTo || null,
          intake_source: "walk_in",
          intake_medium: "check_in",
          custom_fields: notes.trim() ? { initial_notes: notes.trim() } : {},
          is_final: true,
          step: 1,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || "Failed to create lead");
        setSubmitting(false);
        return;
      }

      const newLeadId = json.data?.id;
      if (newLeadId) {
        await fetch(`/api/v1/leads/${newLeadId}/check-in`, { method: "POST" });
        toast.success("Lead added and checked in");
        fetchHistory();
        // Reset form
        setQuery("");
        setResults([]);
        setSearched(false);
        setShowAddForm(false);
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setNotes("");
        setAssignedTo("");
        setSubmitting(false);
      }
    } catch {
      toast.error("Failed to create lead");
      setSubmitting(false);
    }
  };

  // Pre-fill email or phone in add form based on query
  useEffect(() => {
    if (showAddForm && query) {
      const isEmail = query.includes("@");
      if (isEmail) {
        setEmail(query);
        setPhone("");
      } else {
        setPhone(query);
        setEmail("");
      }
    }
  }, [showAddForm, query]);

  const handleExportCSV = () => {
    if (checkIns.length === 0) {
      toast.error("No check-ins to export");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Pipeline", "Stage", "Checked In At", "Checked In By"];
    const rows = checkIns.map((r) => [
      [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
      r.email || "",
      r.phone || "",
      r.pipeline_name || "",
      r.stage_name || "",
      new Date(r.checked_in_at).toLocaleString(),
      r.checked_in_by || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `check-ins-${dateFilter === "custom" ? `${customFrom}-to-${customTo}` : dateFilter}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    if (isToday) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="flex flex-col h-full p-6">
      {/* Search Section — compact, does not grow */}
      <div className="shrink-0 max-w-2xl mx-auto w-full mb-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Check-In</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search by email or phone number to check in a visitor
          </p>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Enter email or phone number..."
            className="pl-10 h-12 text-base"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search Results — compact dropdown-like area */}
        {results.length > 0 && (
          <Card className="mt-2 overflow-hidden">
            <CardContent className="p-1">
              {results.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-2.5 rounded-md cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => handleCheckIn(lead.id)}
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                    {(lead.first_name?.[0] || lead.email?.[0] || "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "No Name"}
                      </span>
                      {lead.stage_name && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] shrink-0"
                          style={{
                            backgroundColor: `${lead.stage_color}20`,
                            color: lead.stage_color || undefined,
                          }}
                        >
                          {lead.stage_name}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {lead.email && <span>{lead.email}</span>}
                      {lead.phone && <span>{lead.phone}</span>}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {checkingIn === lead.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <UserCheck className="h-4 w-4 text-green-600" />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* No Results - Add Lead Form */}
        {searched && results.length === 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                No existing lead found. Add a new one:
              </span>
            </div>

            {showAddForm && (
              <Card>
                <CardContent className="p-4">
                  <form onSubmit={handleAddLead} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="firstName" className="text-xs">First Name</Label>
                        <Input
                          id="firstName"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="First name"
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                        <Input
                          id="lastName"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Last name"
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="email" className="text-xs">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email@example.com"
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="phone" className="text-xs">Phone</Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+977..."
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Pipeline</Label>
                        <Select value={pipelineId} onValueChange={(v) => setPipelineId(v)}>
                          <SelectTrigger className="h-9">
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
                      <div className="space-y-1">
                        <Label className="text-xs">Stage</Label>
                        <Select value={stageId} onValueChange={(v) => setStageId(v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select stage" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredStages.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: s.color }}
                                  />
                                  {s.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Assign Counselor</Label>
                      <Select value={assignedTo} onValueChange={(v) => setAssignedTo(v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select counselor (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {teamMembers.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.email} ({m.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="notes" className="text-xs">Notes</Label>
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add any notes about this visit..."
                        className="min-h-[60px] resize-none text-sm"
                      />
                    </div>

                    <Button type="submit" className="w-full h-9" disabled={submitting}>
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Add Lead & Check In
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Check-In History — fills remaining height */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header row: title left, filter right */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Check-In History
            <Badge variant="secondary" className="text-xs ml-1">
              {checkIns.length}
            </Badge>
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["today", "week", "month", "custom"] as DateFilter[]).map((f) => (
                <Button
                  key={f}
                  variant={dateFilter === f ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7 px-2.5"
                  onClick={() => setDateFilter(f)}
                >
                  {f === "today" ? "Today" : f === "week" ? "This Week" : f === "month" ? "This Month" : "Custom"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-7 text-xs w-[130px]"
              />
            </div>
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 text-xs w-[130px]"
            />
          </div>
        )}

        {/* History Card — fills remaining space with scrollable content */}
        <Card className="flex-1 flex flex-col min-h-0">
          <CardContent className="flex-1 flex flex-col min-h-0 p-0">
            {/* CSV Download inside card top-right */}
            <div className="flex justify-end p-3 pb-0 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 px-2.5"
                onClick={handleExportCSV}
                disabled={checkIns.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                Export CSV
              </Button>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : checkIns.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                No check-ins found for this period
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 pt-2 space-y-1">
                {checkIns.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      if (record.lead_id) router.push(`/check-in/${record.lead_id}`);
                    }}
                  >
                    <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-medium text-green-700 shrink-0">
                      {(record.first_name?.[0] || record.email?.[0] || "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {[record.first_name, record.last_name].filter(Boolean).join(" ") || record.email || "Unknown"}
                        </span>
                        {record.stage_name && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] shrink-0"
                            style={{
                              backgroundColor: `${record.stage_color}20`,
                              color: record.stage_color || undefined,
                            }}
                          >
                            {record.stage_name}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {record.email && <span>{record.email}</span>}
                        {record.phone && <span>{record.phone}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-medium">{formatTime(record.checked_in_at)}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDate(record.checked_in_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
