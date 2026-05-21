"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  Calendar,
  Clock,
  User,
} from "lucide-react";
import type { Lead } from "@/types/database";

interface CheckInNote {
  id: string;
  content: string;
  created_at: string;
  user_email: string;
}

interface CheckInDetailPageProps {
  lead: Lead;
  stageName: string | null;
  stageColor: string | null;
  pipelineName: string | null;
  entityName: string | null;
  assignedToEmail: string | null;
  checkInHistory: CheckInNote[];
}

export function CheckInDetailPage({
  lead,
  stageName,
  stageColor,
  pipelineName,
  entityName,
  assignedToEmail,
  checkInHistory,
}: CheckInDetailPageProps) {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
  const initials = (lead.first_name?.[0] || lead.email?.[0] || "?").toUpperCase();

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  };

  const createdAt = formatDateTime(lead.created_at);

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Back button */}
      <div className="shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2">
          <Link href="/check-in">
            <ArrowLeft className="h-4 w-4" />
            Back to Check-In
          </Link>
        </Button>
      </div>

      {/* Lead Details Card */}
      <Card className="shrink-0">
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center text-lg font-semibold shrink-0"
              style={{
                backgroundColor: stageColor ? `${stageColor}15` : "var(--primary-10)",
                color: stageColor || "var(--primary)",
              }}
            >
              {initials}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-xl font-bold truncate">{fullName}</h1>
                {stageName && (
                  <Badge
                    variant="secondary"
                    className="shrink-0"
                    style={{
                      backgroundColor: `${stageColor}20`,
                      color: stageColor || undefined,
                    }}
                  >
                    {stageName}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2.5">
                {lead.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{lead.email}</span>
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{lead.phone}</span>
                  </div>
                )}
                {(lead.city || lead.country) && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{[lead.city, lead.country].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {pipelineName && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{pipelineName}</span>
                  </div>
                )}
                {assignedToEmail && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{assignedToEmail}</span>
                  </div>
                )}
                {entityName && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{entityName}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  <span>Added {createdAt.date}</span>
                </div>
              </div>
            </div>

            {/* View Full Profile link */}
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <Link href={`/leads/${lead.id}`}>View Full Profile</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Check-In History Section — fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Visit History
          </h2>
          <Badge variant="secondary" className="text-xs">
            {checkInHistory.length} visit{checkInHistory.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        <Card className="flex-1 flex flex-col min-h-0">
          <CardContent className="flex-1 min-h-0 p-0">
            {checkInHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-12">
                No check-in visits recorded yet
              </div>
            ) : (
              <div className="overflow-y-auto h-full">
                <table className="w-full">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left font-medium px-4 py-2.5">Date</th>
                      <th className="text-left font-medium px-4 py-2.5">Time</th>
                      <th className="text-left font-medium px-4 py-2.5">Note</th>
                      <th className="text-left font-medium px-4 py-2.5">Checked In By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkInHistory.map((record) => {
                      const { date, time } = formatDateTime(record.created_at);
                      // Extract reason from note if present (after the datetime dash)
                      const reasonMatch = record.content.match(/— (.+)$/);
                      const reason = reasonMatch ? reasonMatch[1] : "Walk-in visit";

                      return (
                        <tr
                          key={record.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm">{date}</td>
                          <td className="px-4 py-3 text-sm">{time}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{reason}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{record.user_email}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
