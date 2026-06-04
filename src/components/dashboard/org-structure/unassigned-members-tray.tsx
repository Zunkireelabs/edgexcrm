"use client";

import { cn } from "@/lib/utils";
import type { OrgMember } from "./types";

const avatarBgs = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
  "bg-amber-500", "bg-cyan-500", "bg-fuchsia-500", "bg-teal-500",
];

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff;
  return avatarBgs[h % avatarBgs.length];
}

interface UnassignedMembersTrayProps {
  members: OrgMember[];
  assignablePositions: { id: string; name: string }[];
  onAssignMember: (userId: string, positionId: string) => void;
  isAdmin: boolean;
}

export function UnassignedMembersTray({
  members,
  assignablePositions,
  onAssignMember,
  isAdmin,
}: UnassignedMembersTrayProps) {
  if (members.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-300 overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Unassigned Members
        </p>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap gap-3">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50"
            >
              <div
                title={m.email}
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0",
                  avatarColor(m.email)
                )}
              >
                {m.email.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-700">{m.email}</span>
              {isAdmin && assignablePositions.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      onAssignMember(m.user_id, e.target.value);
                      (e.target as HTMLSelectElement).value = "";
                    }
                  }}
                  className="text-[9px] border rounded px-1 py-0.5 text-gray-500 bg-white"
                >
                  <option value="">Assign to role…</option>
                  {assignablePositions.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
