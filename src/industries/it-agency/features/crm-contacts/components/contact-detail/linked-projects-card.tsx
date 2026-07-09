"use client";

import Link from "next/link";
import { Plus, Loader2, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ProjectContactRole = "primary" | "technical" | "billing" | "other" | null;

interface ProjectLink {
  role: ProjectContactRole;
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts?: { id: string; name: string } | null;
  } | null;
}

interface LinkedProjectsCardProps {
  projectLinks: ProjectLink[];
  isAdmin: boolean;
  changingRoleFor: string | null;
  onAddToProject: () => void;
  onChangeRole: (projectId: string, role: ProjectContactRole) => void;
  onRemove: (link: ProjectLink) => void;
}

function rolePill(role: ProjectContactRole) {
  if (!role) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg: Record<string, { label: string; className: string }> = {
    primary:   { label: "Primary",   className: "bg-green-100 text-green-800 border-green-200" },
    technical: { label: "Technical", className: "bg-blue-100 text-blue-800 border-blue-200" },
    billing:   { label: "Billing",   className: "bg-amber-100 text-amber-800 border-amber-200" },
    other:     { label: "Other",     className: "bg-muted text-muted-foreground border-border" },
  };
  const c = cfg[role] ?? cfg.other;
  return (
    <Badge variant="outline" className={`text-xs ${c.className}`}>
      {c.label}
    </Badge>
  );
}

export function LinkedProjectsCard({
  projectLinks,
  isAdmin,
  changingRoleFor,
  onAddToProject,
  onChangeRole,
  onRemove,
}: LinkedProjectsCardProps) {
  return (
    <Card className="border border-border shadow-none rounded-lg">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Projects
          </CardTitle>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onAddToProject}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {projectLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No projects linked yet.</p>
        ) : (
          <div className="divide-y">
            {projectLinks.map((pl) => {
              if (!pl.projects) return null;
              const proj = pl.projects;
              const isChanging = changingRoleFor === proj.id;
              return (
                <div
                  key={proj.id}
                  className="flex items-center justify-between gap-2 py-2 group/row"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${proj.id}`}
                        className="text-sm font-medium hover:underline truncate block"
                      >
                        {proj.name}
                      </Link>
                      {proj.accounts?.name && (
                        <p className="text-xs text-muted-foreground">at {proj.accounts.name}</p>
                      )}
                    </div>
                    {rolePill(pl.role)}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                      {isChanging ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-muted-foreground"
                            >
                              Role
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(["primary", "technical", "billing", "other"] as const).map((r) => (
                              <DropdownMenuItem
                                key={r}
                                onClick={() => onChangeRole(proj.id, r)}
                                className={pl.role === r ? "font-medium" : ""}
                              >
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </DropdownMenuItem>
                            ))}
                            {pl.role !== null && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onChangeRole(proj.id, null)}>
                                  Clear role
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(pl)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
