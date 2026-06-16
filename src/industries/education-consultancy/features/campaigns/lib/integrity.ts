import { normalizePhone } from "@/lib/leads/dedup";
import type { LeaderboardEntry } from "./scoring";

export interface IntegrityFlag {
  type: "shared_phone" | "shared_name";
  detail: string;
}

// Pure overlay — admin-only. Never called from the public route.
export function annotateIntegrity(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const phoneMap = new Map<string, LeaderboardEntry[]>();
  for (const entry of entries) {
    const normalized = normalizePhone(entry.phone);
    if (!normalized) continue;
    const group = phoneMap.get(normalized) ?? [];
    group.push(entry);
    phoneMap.set(normalized, group);
  }

  const nameMap = new Map<string, LeaderboardEntry[]>();
  for (const entry of entries) {
    if (entry.name.includes("@")) continue;
    const normalized = entry.name.trim().toLowerCase().replace(/\s+/g, " ");
    const group = nameMap.get(normalized) ?? [];
    group.push(entry);
    nameMap.set(normalized, group);
  }

  const flagsMap = new Map<string, IntegrityFlag[]>();

  function getFlags(email: string): IntegrityFlag[] {
    if (!flagsMap.has(email)) flagsMap.set(email, []);
    return flagsMap.get(email)!;
  }

  for (const group of phoneMap.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      const others = group.filter((e) => e.email !== entry.email);
      getFlags(entry.email).push({
        type: "shared_phone",
        detail: `Shares phone with ${others.map((o) => `${o.name} (#${o.rank})`).join(", ")}`,
      });
    }
  }

  for (const group of nameMap.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      const others = group.filter((e) => e.email !== entry.email);
      getFlags(entry.email).push({
        type: "shared_name",
        detail: `Same name as ${others.map((o) => `${o.name} (#${o.rank})`).join(", ")}`,
      });
    }
  }

  return entries.map((entry) => {
    const flags = flagsMap.get(entry.email);
    return flags && flags.length > 0 ? { ...entry, flags } : entry;
  });
}
