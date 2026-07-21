import { memberGradient, memberInitialsColor, getInitials } from "@/lib/ui/member-gradient";

/** Gradient+initials avatar for an internal team member. Do not use for external people (contacts/accounts/lead persons) — seed must be a user_id. */
export function MemberAvatar({ userId, name, size = 20 }: { userId: string; name: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 font-semibold select-none leading-none"
      style={{
        height: size,
        width: size,
        backgroundImage: memberGradient(userId),
        color: memberInitialsColor(userId),
        fontSize: Math.round(size * 0.42),
      }}
    >
      {getInitials(name)}
    </span>
  );
}
