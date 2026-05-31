"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2 } from "lucide-react";

interface AccountCardProps {
  accountId: string;
  accountName: string;
  ownerEmail: string | null;
  projectCount: number;
  siblingCount: number;
}

export function AccountCard({ accountId, accountName, ownerEmail, projectCount, siblingCount }: AccountCardProps) {
  return (
    <Card className="border border-border shadow-none rounded-lg">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Account
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-2">
        <Link
          href={`/accounts/${accountId}`}
          className="text-sm font-medium hover:underline block"
          style={{ color: "#0f0f10" }}
        >
          {accountName}
        </Link>
        {ownerEmail && (
          <p className="text-xs" style={{ color: "#787871" }}>
            Owner: {ownerEmail}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Badge variant="secondary" className="text-xs">
            {projectCount} {projectCount === 1 ? "project" : "projects"}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {siblingCount} other {siblingCount === 1 ? "contact" : "contacts"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
