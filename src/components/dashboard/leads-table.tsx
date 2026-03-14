"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Eye, Search } from "lucide-react";
import type { Lead, PipelineStage } from "@/types/database";

interface LeadsTableProps {
  leads: Lead[];
  memberMap?: Record<string, string>;
  stages?: PipelineStage[];
  formMap?: Record<string, string>;
}

export function LeadsTable({ leads, memberMap = {}, stages = [], formMap = {} }: LeadsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");

  const formEntries = useMemo(() => Object.entries(formMap), [formMap]);
  const hasMultipleForms = formEntries.length > 1;

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchesStatus =
        statusFilter === "all" || lead.status === statusFilter;
      const matchesForm =
        formFilter === "all" || lead.form_config_id === formFilter;
      const searchLower = search.toLowerCase();
      const assignedEmail = lead.assigned_to ? memberMap[lead.assigned_to] || "" : "";
      const matchesSearch =
        !search ||
        lead.first_name?.toLowerCase().includes(searchLower) ||
        lead.last_name?.toLowerCase().includes(searchLower) ||
        lead.email?.toLowerCase().includes(searchLower) ||
        lead.phone?.toLowerCase().includes(searchLower) ||
        lead.city?.toLowerCase().includes(searchLower) ||
        assignedEmail.toLowerCase().includes(searchLower);
      return matchesStatus && matchesSearch && matchesForm;
    });
  }, [leads, search, statusFilter, formFilter, memberMap]);

  function exportCSV() {
    const headers = [
      "Date",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "City",
      "Country",
      "Status",
      "Assigned To",
      ...(hasMultipleForms ? ["Form"] : []),
    ];
    const rows = filtered.map((l) => [
      new Date(l.created_at).toLocaleDateString(),
      l.first_name || "",
      l.last_name || "",
      l.email || "",
      l.phone || "",
      l.city || "",
      l.country || "",
      l.status,
      l.assigned_to ? memberMap[l.assigned_to] || "" : "",
      ...(hasMultipleForms ? [l.form_config_id ? formMap[l.form_config_id] || "" : ""] : []),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone, city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="enrolled">Enrolled</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        {hasMultipleForms && (
          <Select value={formFilter} onValueChange={setFormFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Forms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Forms</SelectItem>
              {formEntries.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden lg:table-cell">City</TableHead>
              <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              <TableHead>Status</TableHead>
              {hasMultipleForms && (
                <TableHead className="hidden md:table-cell">Form</TableHead>
              )}
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={hasMultipleForms ? 10 : 9}
                  className="text-center py-8 text-muted-foreground"
                >
                  No leads found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead, i) => {
                const assignedEmail = lead.assigned_to
                  ? memberMap[lead.assigned_to]
                  : null;
                const formName = lead.form_config_id
                  ? formMap[lead.form_config_id]
                  : null;
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {lead.first_name} {lead.last_name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {lead.email}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {lead.phone}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">
                      {lead.city}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">
                      {assignedEmail ? (
                        <span className="text-xs">{assignedEmail.split("@")[0]}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const stage = stages.find((s) => s.id === lead.stage_id);
                        return (
                          <Badge
                            variant="secondary"
                            style={
                              stage
                                ? { backgroundColor: `${stage.color}20`, color: stage.color }
                                : undefined
                            }
                          >
                            {stage?.name || lead.status}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    {hasMultipleForms && (
                      <TableCell className="hidden md:table-cell">
                        {formName ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {formName}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Link href={`/leads/${lead.id}`}>
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {leads.length} leads
      </p>
    </div>
  );
}
