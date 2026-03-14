"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, UserPlus, Phone, GraduationCap, XCircle } from "lucide-react";
import type { Lead } from "@/types/database";

const stats = [
  { key: "total", label: "Total Leads", icon: Users, color: "text-foreground" },
  { key: "new", label: "New", icon: UserPlus, color: "text-blue-600" },
  { key: "contacted", label: "Contacted", icon: Phone, color: "text-yellow-600" },
  { key: "enrolled", label: "Enrolled", icon: GraduationCap, color: "text-green-600" },
  { key: "rejected", label: "Rejected", icon: XCircle, color: "text-red-600" },
];

export function StatsCards({ leads }: { leads: Lead[] }) {
  const counts: Record<string, number> = {
    total: leads.length,
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    enrolled: leads.filter((l) => l.status === "enrolled").length,
    rejected: leads.filter((l) => l.status === "rejected").length,
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {stats.map((s) => (
        <Card key={s.key}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{counts[s.key]}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
