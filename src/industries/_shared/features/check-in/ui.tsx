"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronRight,
  X,
  Mail,
  Phone,
  MapPin,
  Globe,
  FileText,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage, PipelineWithCounts } from "@/types/database";
import type { TeamMember } from "@/lib/supabase/queries";
import {
  HEARD_ABOUT_US,
} from "@/industries/_shared/features/lead-lists/taxonomies";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import {
  ACADEMIC_LEVELS,
  TEST_TYPES,
  hasProspectQualification,
} from "@/lib/leads/prospect-qualification";
import { ProspectQualificationDialog } from "@/components/dashboard/leads/prospect-qualification-dialog";

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
  assigned_to: string | null;
  assigned_to_name: string | null;
  // Per-visit "meet with" person for THIS check-in, separate from the lead's
  // assigned counselor (assigned_to).
  meet_with_id: string | null;
  meet_with_name: string | null;
  tags: string[];
  lead_created_at: string | null;
  is_new: boolean;
  stage_name: string | null;
  stage_color: string | null;
  pipeline_name: string | null;
  checked_in_at: string;
  checked_out_at: string | null;
  checked_in_by: string;
  checked_in_by_id: string | null;
  note: string;
}

interface CheckInPageProps {
  tenantId: string;
  pipelines: PipelineWithCounts[];
  stages: PipelineStage[];
  teamMembers: TeamMember[];
  allBranchMembers: TeamMember[];
  industryId: string;
  canAssignAny: boolean;
  canAssignOwnCheckIns: boolean;
  currentUserId: string;
  isAdmin: boolean;
}

type DateFilter = "today" | "yesterday" | "last7" | "last30" | "custom";

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
    case "yesterday": {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      from = start.toISOString();
      to = end.toISOString();
      break;
    }
    case "last7": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      break;
    }
    case "last30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
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

function LeadExtraDetails({ details }: { details: Record<string, unknown> }) {
  const city = details.city ? String(details.city) : null;
  const country = details.country ? String(details.country) : null;
  const customFields = (details.custom_fields && typeof details.custom_fields === "object")
    ? details.custom_fields as Record<string, unknown>
    : null;

  return (
    <div className="space-y-3 mb-6">
      {city && (
        <div className="flex items-center gap-3 text-sm">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          <span>{city}{country ? `, ${country}` : ""}</span>
        </div>
      )}
      {country && !city && (
        <div className="flex items-center gap-3 text-sm">
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          <span>{country}</span>
        </div>
      )}
      {customFields && Object.keys(customFields).length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Additional Info</p>
          <div className="space-y-1.5">
            {Object.entries(customFields).map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                <span className="font-medium text-right max-w-45 truncate">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CheckInPage({ tenantId, pipelines, stages, teamMembers, allBranchMembers, industryId, canAssignAny, canAssignOwnCheckIns, currentUserId, isAdmin }: CheckInPageProps) {
  const router = useRouter();
  const { destinations: destOptions, fieldsOfStudy: fieldOfStudyOptions, studyLevels: studyLevelOptions } = useEduTaxonomy();
  const memberNameById = new Map(
    allBranchMembers.map((m) => [m.user_id, m.name || m.email.split("@")[0]]),
  );
  const isCounselor = (m: TeamMember) =>
    m.position_slug === "counselor" || (m.position_slug == null && m.role === "counselor");
  const counselorMembers = industryId !== "travel_agency"
    ? allBranchMembers.filter(isCounselor)
    : allBranchMembers;
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [meetWithId, setMeetWithId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [leadDetails, setLeadDetails] = useState<Record<string, unknown> | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

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
  const [leadTag, setLeadTag] = useState<string>("student");
  const [submitting, setSubmitting] = useState(false);

  // Student-only education fields (revealed when the Student tag is active)
  const [destination, setDestination] = useState("");
  const [studyLevel, setStudyLevel] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [academics, setAcademics] = useState<Record<string, string>>({});
  const [testScores, setTestScores] = useState<Record<string, string>>({});
  const [academicsOpen, setAcademicsOpen] = useState(false);
  const [academicsError, setAcademicsError] = useState(false);
  const updateAcademic = (col: string, value: string) =>
    setAcademics((prev) => ({ ...prev, [col]: value }));
  const updateTestScore = (col: string, value: string) =>
    setTestScores((prev) => ({ ...prev, [col]: value }));

  // Assign-a-counselor gate (§6b hard-block): assigning a new walk-in's counselor from
  // the check-in history table can hit the server's 422 (would auto-promote an
  // unqualified lead into Prospects). Deferred until this fill-in dialog is confirmed.
  const [pendingAssignGate, setPendingAssignGate] = useState<{
    record: CheckInRecord;
    userId: string;
  } | null>(null);

  // Check-in history state — every checked-in visitor shows here regardless of tag
  // (Other-tagged ones also surface separately on the Contacts page).
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);
  const visibleCheckIns = checkIns;
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

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

  const handleViewDetails = async (lead: LeadResult) => {
    setSelectedLead(lead);
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`);
      const json = await res.json();
      if (json.data) {
        setLeadDetails(json.data);
      }
    } catch {
      // Fall back to search result data
      setLeadDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedLead(null);
    setLeadDetails(null);
  };

  const handleCheckIn = async (leadId: string) => {
    setCheckingIn(leadId);
    try {
      // "Meet with" is a per-visit record stored on the check-in note — it does
      // NOT reassign the lead's counselor (lead.assigned_to). Front-desk picks
      // never clobber the lead's assignment.
      const res = await fetch(`/api/v1/leads/${leadId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meet_with_id: meetWithId || null }),
      });
      if (!res.ok) {
        toast.error("Failed to check in");
        setCheckingIn(null);
        return;
      }
      toast.success("Check-in recorded");
      fetchHistory();
      setQuery("");
      setResults([]);
      setSearched(false);
      setMeetWithId("");
      setCheckingIn(null);
    } catch {
      toast.error("Failed to check in");
      setCheckingIn(null);
    }
  };

  const handleAssign = async (record: CheckInRecord, userId: string | null) => {
    if (assigningId) return;
    setAssigningId(record.id);
    try {
      const name = userId ? memberNameById.get(userId) ?? null : null;
      if (record.is_new) {
        // New walk-in student → "Assigned To" is the lead's counselor.
        // Assigning it updates the lead (and fires auto-promotion server-side).
        if (!record.lead_id) return;
        const res = await fetch(`/api/v1/leads/${record.lead_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigned_to: userId }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const academicMsg = errJson?.error?.details?.academic?.[0] as string | undefined;
          if (academicMsg && userId) {
            toast.error(academicMsg);
            setPendingAssignGate({ record, userId });
            return;
          }
          toast.error("Failed to assign lead");
          return;
        }
        setCheckIns((prev) =>
          prev.map((c) =>
            c.id === record.id ? { ...c, assigned_to: userId, assigned_to_name: name } : c,
          ),
        );
        toast.success(userId ? "Lead assigned" : "Lead unassigned");
      } else {
        // Everyone else → "Meet with" is a per-visit record on the check-in
        // note; editing it never touches the lead's counselor assignment.
        const res = await fetch(`/api/v1/check-ins/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meet_with_id: userId }),
        });
        if (!res.ok) {
          toast.error("Failed to update meet-with");
          return;
        }
        setCheckIns((prev) =>
          prev.map((c) =>
            c.id === record.id ? { ...c, meet_with_id: userId, meet_with_name: name } : c,
          ),
        );
        toast.success(userId ? "Meet-with updated" : "Meet-with cleared");
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setAssigningId(null);
    }
  };

  const confirmAssignQualification = async (patch: Record<string, string>) => {
    if (!pendingAssignGate) return;
    const { record, userId } = pendingAssignGate;
    if (!record.lead_id) return;
    try {
      const res = await fetch(`/api/v1/leads/${record.lead_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: userId, ...patch }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || "Failed to assign lead");
      }
      const name = memberNameById.get(userId) ?? null;
      setCheckIns((prev) =>
        prev.map((c) =>
          c.id === record.id ? { ...c, assigned_to: userId, assigned_to_name: name } : c,
        ),
      );
      toast.success("Lead assigned");
      setPendingAssignGate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign lead");
    }
  };

  const handleCheckOut = async (record: CheckInRecord) => {
    if (checkingOutId) return;
    setCheckingOutId(record.id);
    try {
      const res = await fetch(`/api/v1/check-ins/${record.id}/checkout`, { method: "PATCH" });
      if (!res.ok) { toast.error("Failed to check out"); return; }
      const now = new Date().toISOString();
      setCheckIns((prev) =>
        prev.map((c) => c.id === record.id ? { ...c, checked_out_at: now } : c),
      );
      toast.success("Checked out");
    } catch {
      toast.error("Failed to check out");
    } finally {
      setCheckingOutId(null);
    }
  };

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName && !email && !phone) {
      toast.error("Please provide at least a name, email, or phone");
      return;
    }

    if (
      industryId === "education_consultancy" &&
      leadTag === "student" &&
      assignedTo &&
      !hasProspectQualification(academics)
    ) {
      setAcademicsOpen(true);
      setAcademicsError(true);
      toast.error(
        "Enter the student's highest qualification (%/GPA) before assigning a counselor."
      );
      return;
    }
    setAcademicsError(false);

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
          assigned_to: (leadTag === "other" ? meetWithId : assignedTo) || null,
          intake_source: referralSource || "walk_in",
          intake_campaign:
            (referralSource === "referral" || referralSource === "other") &&
            referredBy.trim()
              ? referredBy.trim()
              : null,
          intake_medium: "check_in",
          custom_fields: notes.trim() ? { initial_notes: notes.trim() } : {},
          tags: industryId === "travel_agency" ? [] : [leadTag],
          // Student-only structured education fields
          ...(industryId !== "travel_agency" && leadTag === "student"
            ? {
                destinations: destination ? [destination] : [],
                degree_level: studyLevel || null,
                field_of_study: fieldOfStudy || null,
              }
            : {}),
          ...(industryId === "education_consultancy" && leadTag === "student"
            ? { ...academics, ...testScores }
            : {}),
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
        const checkInRes = await fetch(`/api/v1/leads/${newLeadId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: notes.trim() || undefined }),
        });
        if (checkInRes.ok) {
          toast.success("Lead added and checked in");
        } else {
          toast.error("Lead added, but check-in failed");
        }
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
        setMeetWithId("");
        setDestination("");
        setStudyLevel("");
        setFieldOfStudy("");
        setReferralSource("");
        setReferredBy("");
        setAcademics({});
        setTestScores({});
        setAcademicsOpen(false);
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
    if (visibleCheckIns.length === 0) {
      toast.error("No check-ins to export");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Pipeline", "Stage", "Checked In At", "Checked In By"];
    const rows = visibleCheckIns.map((r) => [
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
    const filterLabel = dateFilter === "custom" ? `${customFrom}-to-${customTo}` : dateFilter === "yesterday" ? "yesterday" : dateFilter === "last7" ? "last-7-days" : dateFilter === "last30" ? "last-30-days" : dateFilter;
    link.download = `check-ins-${filterLabel}-${new Date().toISOString().split("T")[0]}.csv`;
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
    <div className="flex h-full">
      {/* Main content */}
      <div className={`flex-1 flex flex-col h-full p-6 overflow-y-auto transition-all ${selectedLead ? "mr-0" : ""}`}>
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
                  className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
                    selectedLead?.id === lead.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/60"
                  }`}
                  onClick={() => handleViewDetails(lead)}
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
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-xs text-primary font-medium">View Details</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
                        <PhoneInput
                          value={phone}
                          onChange={setPhone}
                          placeholder="Phone number"
                          size="sm"
                        />
                      </div>
                    </div>

                    {industryId !== "travel_agency" && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Tag</Label>
                          <div className="flex gap-2">
                            {[
                              { value: "student", activeClass: "bg-blue-100 text-blue-700 ring-2 ring-blue-300" },
                              { value: "other", activeClass: "bg-amber-100 text-amber-700 ring-2 ring-amber-300" },
                            ].map(({ value, activeClass }) => (
                              <button
                                key={value}
                                type="button"
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                                  leadTag === value ? activeClass : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                }`}
                                onClick={() => setLeadTag(value)}
                              >
                                {value.charAt(0).toUpperCase() + value.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Student-only structured fields */}
                        {leadTag === "student" && (
                          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Destination</Label>
                              <Select value={destination} onValueChange={setDestination}>
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Select destination (optional)" />
                                </SelectTrigger>
                                <SelectContent>
                                  {destOptions.map((d) => (
                                    <SelectItem key={d} value={d}>
                                      {d}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Interested Degree Level</Label>
                                <Select value={studyLevel} onValueChange={setStudyLevel}>
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select level (optional)" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {studyLevelOptions.map((lvl) => (
                                      <SelectItem key={lvl} value={lvl}>
                                        {lvl}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Field of Study</Label>
                                <Select value={fieldOfStudy} onValueChange={setFieldOfStudy}>
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select field (optional)" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {fieldOfStudyOptions.map((f) => (
                                      <SelectItem key={f} value={f}>
                                        {f}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Where did you hear about us?</Label>
                                <Select
                                  value={referralSource}
                                  onValueChange={(v) => {
                                    setReferralSource(v);
                                    if (v !== "referral" && v !== "other") setReferredBy("");
                                  }}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select an option" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {HEARD_ABOUT_US.map((s) => (
                                      <SelectItem key={s.value} value={s.value}>
                                        {s.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {(referralSource === "referral" || referralSource === "other") && (
                              <div className="space-y-1">
                                <Label htmlFor="referredBy" className="text-xs">
                                  {referralSource === "referral" ? "Referred by" : "Please specify"}
                                </Label>
                                <Input
                                  id="referredBy"
                                  value={referredBy}
                                  onChange={(e) => setReferredBy(e.target.value)}
                                  placeholder={
                                    referralSource === "referral"
                                      ? "Name of the person who referred them"
                                      : "Where / how did they hear about us?"
                                  }
                                  className="h-9"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Academic Qualification & Test Report — education Student tag only */}
                    {industryId === "education_consultancy" && leadTag === "student" && (
                      <Collapsible open={academicsOpen} onOpenChange={setAcademicsOpen}>
                        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-xs font-medium text-gray-700 hover:text-gray-900">
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${
                              academicsOpen ? "rotate-90" : ""
                            }`}
                          />
                          Academic &amp; test details
                          <span className="text-[10px] text-gray-400 font-normal">(optional)</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-1">
                          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Academic Qualification
                            </p>
                            {ACADEMIC_LEVELS.map((level) => (
                              <div key={level.key} className="space-y-1">
                                <Label className="text-xs">{level.label}</Label>
                                <div className="grid grid-cols-3 gap-2">
                                  <Input
                                    placeholder="%/GPA"
                                    value={academics[`${level.key}_gpa`] || ""}
                                    onChange={(e) => updateAcademic(`${level.key}_gpa`, e.target.value)}
                                    className={`h-8 text-xs ${
                                      academicsError && level.gateEligible
                                        ? "ring-2 ring-destructive"
                                        : ""
                                    }`}
                                  />
                                  <Input
                                    placeholder="School / College"
                                    value={academics[`${level.key}_institution`] || ""}
                                    onChange={(e) => updateAcademic(`${level.key}_institution`, e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                  <Input
                                    placeholder="Passed year"
                                    inputMode="numeric"
                                    value={academics[`${level.key}_passed_year`] || ""}
                                    onChange={(e) => updateAcademic(`${level.key}_passed_year`, e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Test Report &amp; Score
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              {TEST_TYPES.map((t) => (
                                <div key={t.key} className="space-y-1">
                                  <Label className="text-xs">{t.label}</Label>
                                  <Input
                                    placeholder="Score"
                                    value={testScores[`${t.key}_score`] || ""}
                                    onChange={(e) => updateTestScore(`${t.key}_score`, e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Assign Counselor / Meet with */}
                    {leadTag === "other" ? (
                      <div className="space-y-1">
                        <Label className="text-xs">Meet with</Label>
                        <Select value={meetWithId || "__none__"} onValueChange={(v) => setMeetWithId(v === "__none__" ? "" : v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select person (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No one selected</SelectItem>
                            {allBranchMembers.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.name || m.email.split("@")[0]} ({m.position_name ?? m.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">{industryId === "travel_agency" ? "Assign Team Member" : "Assigned To"}</Label>
                        <Select value={assignedTo || "__none__"} onValueChange={(v) => setAssignedTo(v === "__none__" ? "" : v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={industryId === "travel_agency" ? "Select team member (optional)" : "Select counselor (optional)"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              {industryId === "travel_agency" ? "No team member" : "No counselor"}
                            </SelectItem>
                            {counselorMembers.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.name || m.email.split("@")[0]} ({m.position_name ?? m.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

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

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 h-9"
                        disabled={submitting}
                        onClick={() => {
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
                          setDestination("");
                          setStudyLevel("");
                          setFieldOfStudy("");
                          setReferralSource("");
                          setReferredBy("");
                          setAcademics({});
                          setTestScores({});
                          setAcademicsOpen(false);
                          setAcademicsError(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1 h-9" disabled={submitting}>
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
                    </div>
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
              {visibleCheckIns.length}
            </Badge>
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["today", "yesterday", "last7", "last30", "custom"] as DateFilter[]).map((f) => (
                <Button
                  key={f}
                  variant={dateFilter === f ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7 px-2.5"
                  onClick={() => setDateFilter(f)}
                >
                  {f === "today" ? "Today" : f === "yesterday" ? "Yesterday" : f === "last7" ? "Last 7 Days" : f === "last30" ? "Last 30 Days" : "Custom"}
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
            {/* CSV Download inside card top-right — admin/owner only */}
            {isAdmin && (
              <div className="flex justify-end p-3 pb-0 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 px-2.5"
                  onClick={handleExportCSV}
                  disabled={visibleCheckIns.length === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export CSV
                </Button>
              </div>
            )}

            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : visibleCheckIns.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                No check-ins found for this period
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 pt-2 space-y-1">
                {visibleCheckIns.map((record) => {
                  const checkedInByName = memberNameById.get(record.checked_in_by_id ?? "") || record.checked_in_by;
                  const noteContent = (() => {
                    const raw = record.note || "";
                    const dashIdx = raw.indexOf(" — ");
                    return dashIdx !== -1 ? raw.slice(dashIdx + 3).trim() : "";
                  })();
                  const canAssignThis = canAssignAny || record.checked_in_by_id === currentUserId;
                  // New walk-in student → the column is the lead's assigned
                  // counselor (assigned_to). Everyone else → the per-visit "meet with"
                  // person recorded on this note (meet_with_id), independent of the
                  // lead's assignment — so an unselected visit shows no one.
                  const meetWithId = record.is_new
                    ? (record.assigned_to && record.assigned_to !== record.checked_in_by_id ? record.assigned_to : null)
                    : record.meet_with_id;
                  const meetWithName = meetWithId
                    ? (record.is_new
                        ? (record.assigned_to_name || memberNameById.get(meetWithId) || null)
                        : (record.meet_with_name || memberNameById.get(meetWithId) || null))
                    : null;
                  return (
                    <div
                      key={record.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => { if (record.lead_id) router.push(`/check-in/${record.lead_id}`); }}
                    >
                      {/* Avatar */}
                      <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-medium text-green-700 shrink-0">
                        {(record.first_name?.[0] || record.email?.[0] || "?").toUpperCase()}
                      </div>

                      {/* Name */}
                      <div className="w-36 shrink-0 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {[record.first_name, record.last_name].filter(Boolean).join(" ") || record.email || "Unknown"}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{record.phone || record.email || ""}</div>
                      </div>

                      {/* Checked in by */}
                      <div className="w-32 shrink-0 min-w-0">
                        <div className="text-[10px] text-muted-foreground">Checked in by</div>
                        <div className="text-xs font-medium truncate">{checkedInByName}</div>
                      </div>

                      {/* Assigned To / Meet with — depends on whether the lead was new (walk-in) or already existed */}
                      {(() => {
                        const isStudent = (record.tags ?? []).includes("student");
                        const isNew = isStudent && record.is_new;
                        const colLabel = isNew ? "Assigned To" : "Meet with";
                        const colMembers = isNew ? counselorMembers : allBranchMembers;
                        return (
                          <div className="w-36 shrink-0 min-w-0" onClick={(e) => e.stopPropagation()}>
                            <div className="text-[10px] text-muted-foreground">{colLabel}</div>
                            {meetWithId == null && canAssignThis ? (
                              <Select
                                value="__unassigned__"
                                onValueChange={(v) => handleAssign(record, v === "__unassigned__" ? null : v)}
                                disabled={assigningId === record.id}
                              >
                                <SelectTrigger className="h-6 w-full border-none bg-transparent px-0 shadow-none text-xs hover:bg-muted focus:ring-0 font-medium">
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__unassigned__">Not selected</SelectItem>
                                  {colMembers.map((m) => (
                                    <SelectItem key={m.user_id} value={m.user_id}>
                                      {m.name || m.email.split("@")[0]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="text-xs font-medium truncate">{meetWithName || <span className="text-muted-foreground italic">—</span>}</div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Notes */}
                      <div className="flex-1 min-w-0">
                        {noteContent && (
                          <>
                            <div className="text-[10px] text-muted-foreground">Notes</div>
                            <div className="text-xs truncate text-muted-foreground">{noteContent}</div>
                          </>
                        )}
                      </div>

                      {/* Check Out + time */}
                      <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {!record.checked_out_at ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs px-2" disabled={checkingOutId === record.id} onClick={() => handleCheckOut(record)}>
                            {checkingOutId === record.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Check Out"}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-green-600 font-medium whitespace-nowrap">Out {formatTime(record.checked_out_at)}</span>
                        )}
                        <div className="text-right">
                          <div className="text-xs font-medium">{formatTime(record.checked_in_at)}</div>
                          <div className="text-[10px] text-muted-foreground">{formatDate(record.checked_in_at)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>

      {/* Detail Panel — right side */}
      {selectedLead && (
        <div className="w-[380px] shrink-0 border-l bg-background h-full overflow-y-auto">
          <div className="p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Lead Details</h3>
              <button
                onClick={handleCloseDetails}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Lead info */}
            <div className="text-center mb-5">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary mx-auto mb-3">
                {(selectedLead.first_name?.[0] || selectedLead.email?.[0] || "?").toUpperCase()}
              </div>
              <h2 className="font-semibold text-lg">
                {[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(" ") || "No Name"}
              </h2>
              {selectedLead.stage_name && (
                <Badge
                  variant="secondary"
                  className="mt-1.5 text-xs"
                  style={{
                    backgroundColor: `${selectedLead.stage_color}20`,
                    color: selectedLead.stage_color || undefined,
                  }}
                >
                  {selectedLead.stage_name}
                </Badge>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-3 mb-6">
              {selectedLead.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{selectedLead.email}</span>
                </div>
              )}
              {selectedLead.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{selectedLead.phone}</span>
                </div>
              )}
              {selectedLead.pipeline_name && (
                <div className="flex items-center gap-3 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{selectedLead.pipeline_name}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  Created {new Date(selectedLead.created_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric"
                  })}
                </span>
              </div>
            </div>

            {/* Additional details from API */}
            {loadingDetails && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {leadDetails && !loadingDetails && (
              <LeadExtraDetails details={leadDetails} />
            )}

            {/* Tag selector — education only */}
            {leadDetails && industryId !== "travel_agency" && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tag</p>
                <div className="flex gap-2">
                  {[
                    { value: "student", activeClass: "bg-blue-100 text-blue-700 ring-2 ring-blue-300" },
                    { value: "other", activeClass: "bg-amber-100 text-amber-700 ring-2 ring-amber-300" },
                  ].map(({ value, activeClass }) => {
                    const currentTags = (leadDetails as Record<string, unknown>).tags as string[] || [];
                    const isActive = currentTags.includes(value);
                    return (
                      <button
                        key={value}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                          isActive ? activeClass : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                        onClick={async () => {
                          const newTags = [value];
                          try {
                            await fetch(`/api/v1/leads/${selectedLead.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ tags: newTags }),
                            });
                            setLeadDetails((prev) => prev ? { ...prev, tags: newTags } : prev);
                            toast.success(`Tagged as ${value}`);
                          } catch {
                            toast.error("Failed to update tag");
                          }
                        }}
                      >
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Meet with — who the visitor is meeting today */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Meet with</p>
              <Select value={meetWithId || "__none__"} onValueChange={(v) => setMeetWithId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select person (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No one selected</SelectItem>
                  {allBranchMembers.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.name || m.email.split("@")[0]} ({m.position_name ?? m.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Check-in button */}
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                handleCheckIn(selectedLead.id);
                handleCloseDetails();
              }}
              disabled={checkingIn === selectedLead.id}
            >
              {checkingIn === selectedLead.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Checking in...
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4 mr-2" />
                  Check In
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <ProspectQualificationDialog
        lead={{}}
        open={!!pendingAssignGate}
        onConfirm={confirmAssignQualification}
        onCancel={() => setPendingAssignGate(null)}
      />
    </div>
  );
}
