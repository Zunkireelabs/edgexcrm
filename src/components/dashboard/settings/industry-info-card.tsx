"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  GraduationCap,
  Code,
  HardHat,
  Home,
  HeartPulse,
  Briefcase,
  Folder,
} from "lucide-react";
import type { Industry, IndustryId } from "@/types/database";

interface IndustryInfoCardProps {
  industry: Industry | null;
}

const industryIcons: Record<string, React.ElementType> = {
  "graduation-cap": GraduationCap,
  code: Code,
  "hard-hat": HardHat,
  building: Home,
  "heart-pulse": HeartPulse,
  briefcase: Briefcase,
  folder: Folder,
};

const industryColors: Record<IndustryId, string> = {
  education_consultancy: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  it_agency: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  construction: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  real_estate: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  healthcare: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  recruitment: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export function IndustryInfoCard({ industry }: IndustryInfoCardProps) {
  if (!industry) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Industry
          </CardTitle>
          <CardDescription>
            No industry has been assigned to your organization yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Contact your platform administrator to set up your industry classification.
          </p>
        </CardContent>
      </Card>
    );
  }

  const IconComponent = industry.icon
    ? industryIcons[industry.icon] || Building2
    : Building2;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconComponent className="h-5 w-5" />
          Industry
        </CardTitle>
        <CardDescription>
          Your organization&apos;s industry classification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className={`text-sm ${industryColors[industry.id] || ""}`}
          >
            {industry.name}
          </Badge>
        </div>

        {industry.description && (
          <p className="text-sm text-muted-foreground">{industry.description}</p>
        )}

        <div className="rounded-md border bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">This tenant manages</p>
          <p className="text-sm font-medium">{industry.entity_type_label}</p>
        </div>

        <p className="text-xs text-muted-foreground">
          Industry settings are configured by the platform administrator and cannot be changed here.
        </p>
      </CardContent>
    </Card>
  );
}
