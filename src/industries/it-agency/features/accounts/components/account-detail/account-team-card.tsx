"use client";

import { formatRelativeTime } from "@/lib/format-relative-time";

export interface TeamOwner {
  user_id: string;
  email: string | null;
  role_label: "Account Manager" | "Project Lead";
  is_account_owner: boolean;
  owned_projects_count: number;
  hrs_this_month: number;
  last_active_at: string | null;
}

export interface TeamContributor {
  user_id: string;
  email: string | null;
  role_label: "Contributor";
  hrs_this_month: number;
  last_active_at: string;
}

export interface AccountTeam {
  owners: TeamOwner[];
  contributors: TeamContributor[];
}

interface AccountTeamCardProps {
  team: AccountTeam;
}

function getInitialsFromEmail(email: string | null): string {
  if (!email) return "?";
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function rolePillClass(role: string): string {
  if (role === "Account Manager") return "bg-purple-50 text-purple-700";
  if (role === "Project Lead") return "bg-blue-50 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function isLastActiveTooOld(lastActiveAt: string | null): boolean {
  if (!lastActiveAt) return false;
  const diff = new Date().getTime() - new Date(lastActiveAt).getTime();
  return diff > FOURTEEN_DAYS_MS;
}

function TeamRow({
  email,
  roleLabel,
  hrsThisMonth,
  lastActiveAt,
  subtitle,
}: {
  email: string | null;
  roleLabel: string;
  hrsThisMonth: number;
  lastActiveAt: string | null;
  subtitle?: string;
}) {
  const isInactive = isLastActiveTooOld(lastActiveAt);

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[10px] font-semibold text-muted-foreground">
          {getInitialsFromEmail(email)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate" style={{ color: "#0f0f10" }}>
            {email ?? "Unknown"}
          </span>
          <span className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded ${rolePillClass(roleLabel)}`}>
            {roleLabel}
          </span>
        </div>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: "#787871" }}>{subtitle}</p>
        )}
        {isInactive && lastActiveAt && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            Active {formatRelativeTime(lastActiveAt)}
          </p>
        )}
      </div>
      <span className="text-xs shrink-0 mt-0.5" style={{ color: "#787871" }}>
        {hrsThisMonth > 0 ? `${hrsThisMonth.toFixed(1)}h` : "—"}
      </span>
    </div>
  );
}

export function AccountTeamCard({ team }: AccountTeamCardProps) {
  const totalCount = team.owners.length + team.contributors.length;

  if (totalCount === 0) {
    return (
      <div className="border border-border rounded-lg bg-card shadow-none p-3">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Team</h3>
        <p className="text-sm text-muted-foreground mt-2">No team activity yet.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card shadow-none p-3 space-y-3">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        Team ({totalCount})
      </h3>

      {/* Owners group */}
      {team.owners.length > 0 && (
        <div className="space-y-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Owners</p>
          {team.owners.map((owner) => (
            <TeamRow
              key={owner.user_id}
              email={owner.email}
              roleLabel={owner.role_label}
              hrsThisMonth={owner.hrs_this_month}
              lastActiveAt={owner.last_active_at}
              subtitle={
                owner.role_label === "Project Lead" && owner.owned_projects_count > 0
                  ? `Owns ${owner.owned_projects_count} project${owner.owned_projects_count !== 1 ? "s" : ""}`
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Contributors group */}
      {team.contributors.length > 0 && (
        <div className="space-y-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Contributors</p>
          {team.contributors.map((contributor) => (
            <TeamRow
              key={contributor.user_id}
              email={contributor.email}
              roleLabel={contributor.role_label}
              hrsThisMonth={contributor.hrs_this_month}
              lastActiveAt={contributor.last_active_at}
            />
          ))}
        </div>
      )}
    </div>
  );
}
