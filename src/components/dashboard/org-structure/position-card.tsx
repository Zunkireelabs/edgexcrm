"use client";

import { useState } from "react";
import { User, Trash2, ChevronDown, ChevronUp, X, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Position } from "@/types/database";
import type { OrgMember } from "./types";

const tierColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  member: "bg-gray-100 text-gray-600",
  counselor: "bg-gray-100 text-gray-600",
  viewer: "bg-gray-100 text-gray-600",
};

const roleColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  counselor: "bg-purple-100 text-purple-800",
  viewer: "bg-gray-100 text-gray-600",
};

const avatarBgs = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
  "bg-amber-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500",
];

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff;
  return avatarBgs[h % avatarBgs.length];
}

interface PositionCardProps {
  position: Position & { member_count: number; members: OrgMember[] };
  showDelete?: boolean;
  onDelete?: () => void;
  compact?: boolean;
  isAdmin?: boolean;
  assignablePositions?: { id: string; name: string }[];
  unassignedMembers?: OrgMember[];
  onMoveMember?: (userId: string, positionId: string) => void;
  onRemoveMember?: (userId: string) => void;
  onAssignMember?: (userId: string, positionId: string) => void;
}

export function PositionCard({
  position,
  showDelete,
  onDelete,
  compact,
  isAdmin,
  assignablePositions = [],
  unassignedMembers = [],
  onMoveMember,
  onRemoveMember,
  onAssignMember,
}: PositionCardProps) {
  const [expanded, setExpanded] = useState(false);

  const tierColor = tierColors[position.base_tier] ?? "bg-gray-100 text-gray-600";
  const members = position.members ?? [];
  const visible = members.slice(0, 4);
  const overflow = members.length > 4 ? members.length - 4 : 0;

  const canExpand = !compact && (members.length > 0 || (isAdmin && unassignedMembers.length > 0));

  return (
    <div className={cn(
      "group relative flex flex-col items-center border-2 border-gray-200 bg-white rounded-lg transition-all hover:shadow-md hover:border-gray-300",
      compact ? "p-3 min-w-[120px]" : "p-4 min-w-[140px]",
      expanded && !compact && "border-gray-300 shadow-md"
    )}>
      {showDelete && !position.is_system && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
          className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}

      <User className="w-5 h-5 text-gray-600 mb-2" />
      <p className="text-sm font-semibold text-gray-700 text-center">{position.name}</p>
      <span className={cn("mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full", tierColor)}>
        {position.base_tier}
      </span>

      {/* Face-pile row */}
      {(members.length > 0 || canExpand) && (
        <div className="flex items-center gap-1 mt-2">
          {members.length > 0 && (
            <>
              <div className="flex -space-x-1.5">
                {visible.map((m) => (
                  <div
                    key={m.user_id}
                    title={m.email}
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-1 ring-white",
                      avatarColor(m.email)
                    )}
                  >
                    {m.email.charAt(0).toUpperCase()}
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] text-gray-600 ring-1 ring-white">
                    +{overflow}
                  </div>
                )}
              </div>
              {!compact && (
                <span className="text-[10px] text-gray-500">
                  {members.length} member{members.length !== 1 ? "s" : ""}
                </span>
              )}
            </>
          )}
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-0.5 hover:bg-gray-100 rounded"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded
                ? <ChevronUp className="w-3 h-3 text-gray-500" />
                : <ChevronDown className="w-3 h-3 text-gray-500" />}
            </button>
          )}
        </div>
      )}

      {/* Expanded roster */}
      {expanded && !compact && (
        <div className="mt-3 w-full border-t border-gray-100 pt-3 space-y-2">
          <p className="text-[10px] text-gray-400 italic">
            Changing a position updates this person&apos;s access.
          </p>

          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-1.5 w-full">
              <div
                title={m.email}
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0",
                  avatarColor(m.email)
                )}
              >
                {m.email.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-700 flex-1 truncate min-w-0">{m.email}</span>
              <span className={cn(
                "text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                roleColors[m.role] ?? "bg-gray-100 text-gray-600"
              )}>
                {m.role}
              </span>
              {isAdmin && (
                <>
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) onMoveMember?.(m.user_id, e.target.value); }}
                    className="text-[9px] border rounded px-1 py-0.5 text-gray-500 bg-white shrink-0"
                    title="Move to role"
                  >
                    <option value="">Move to…</option>
                    {assignablePositions
                      .filter((p) => p.id !== position.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                  </select>
                  <button
                    onClick={() => onRemoveMember?.(m.user_id)}
                    className="p-0.5 hover:bg-red-100 rounded shrink-0"
                    title="Remove from team"
                  >
                    <X className="w-3 h-3 text-red-500" />
                  </button>
                </>
              )}
            </div>
          ))}

          {/* Assign unassigned member into this position */}
          {isAdmin && unassignedMembers.length > 0 && (
            <div className="flex items-center gap-1.5 w-full pt-1 border-t border-gray-100">
              <UserPlus className="w-3 h-3 text-gray-400 shrink-0" />
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    onAssignMember?.(e.target.value, position.id);
                    (e.target as HTMLSelectElement).value = "";
                  }
                }}
                className="text-[9px] border rounded px-1 py-0.5 text-gray-500 bg-white flex-1"
              >
                <option value="">+ assign member…</option>
                {unassignedMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.email}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
