"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContactStatus } from "@/types/database";

interface ContactTabsContact {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: ContactStatus;
  notes: string | null;
  accounts: { id: string; name: string } | null;
}

interface ContactTabsProps {
  contact: ContactTabsContact;
  onEditClick: () => void;
}

function InfoGridRow({ label, value, isLink, linkType }: {
  label: string;
  value: string | null | undefined;
  isLink?: boolean;
  linkType?: "email" | "phone";
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {isLink ? (
        <a
          href={linkType === "email" ? `mailto:${value}` : `tel:${value}`}
          className="font-medium text-primary hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="font-medium">{value}</span>
      )}
    </div>
  );
}

export function ContactTabs({ contact, onEditClick }: ContactTabsProps) {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "—";

  return (
    <TooltipProvider>
      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <TabsTrigger value="notes" disabled>
                  Notes
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <TabsTrigger value="activity" disabled>
                  Activity
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-0">
          {/* Personal Information */}
          <Card className="shadow-none rounded-lg py-0">
            <CardHeader className="pt-4 pb-3">
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pb-4">
              <InfoGridRow label="Full Name" value={fullName} />
              <InfoGridRow label="Email" value={contact.email} isLink linkType="email" />
              <InfoGridRow label="Phone" value={contact.phone} isLink linkType="phone" />
            </CardContent>
          </Card>

          {/* Professional Details */}
          <Card className="shadow-none rounded-lg py-0">
            <CardHeader className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Professional Details</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onEditClick}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">Edit contact</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pb-4">
              <InfoGridRow label="Title" value={contact.title} />
              {contact.accounts && (
                <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <Link
                    href={`/accounts/${contact.accounts.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {contact.accounts.name}
                  </Link>
                </div>
              )}
              <InfoGridRow label="Status" value={contact.status === "active" ? "Active" : "Inactive"} />
              <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
                <span className="text-muted-foreground">Notes</span>
                <span className="font-medium whitespace-pre-wrap">
                  {contact.notes || <span className="text-muted-foreground italic">No notes yet</span>}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
