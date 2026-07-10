"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

export interface AgentOption {
  id: string;
  name: string;
  agent_type: "agent" | "super_agent";
}

export interface PartnerCollegeOption {
  name: string;
  country: string | null;
}

interface ReferenceData {
  agents: AgentOption[];
  partnerColleges: PartnerCollegeOption[];
  countries: string[];
  intakeMonths: string[];
  intakeYears: string[];
}

const EMPTY: ReferenceData = {
  agents: [],
  partnerColleges: [],
  countries: [],
  intakeMonths: [],
  intakeYears: [],
};

// Module-level cache + in-flight promise, shared across every component
// instance for the lifetime of the page. This data (agents, partner colleges,
// destination countries, intake months/years) is identical across all 3 Add
// Application screens and rarely changes within a session — without this,
// each screen (and every repeated open of the same sheet) refetched all 5
// endpoints from scratch. Deliberately excludes program/course suggestions:
// those differ by screen (one reads /api/v1/courses, another derives from
// real past applications via /api/v1/applications/suggestions), so unifying
// them here would change behavior, not just remove duplication.
let cache: ReferenceData | null = null;
let inFlight: Promise<ReferenceData> | null = null;

async function loadReferenceData(): Promise<ReferenceData> {
  const [agentsRes, collegesRes, countriesRes, monthsRes, yearsRes] = await Promise.all([
    fetch("/api/v1/agents").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/partner-colleges").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/countries").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/intake-months").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/intake-years").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  // Country is the only one of these 5 with no safe empty-state meaning —
  // an empty countries list silently disables the Country picker with no
  // explanation, so surface a genuine fetch failure (not just "zero
  // configured") once here rather than per-consumer.
  if (!countriesRes) {
    toast.error("Failed to load destination countries — try again shortly");
  }
  return {
    agents: (agentsRes?.data ?? []) as AgentOption[],
    partnerColleges: ((collegesRes?.data ?? []) as { name: string; country: string | null }[]).map((c) => ({
      name: c.name,
      country: c.country,
    })),
    countries: ((countriesRes?.data ?? []) as { name: string }[]).map((c) => c.name),
    intakeMonths: ((monthsRes?.data ?? []) as { name: string }[]).map((m) => m.name),
    intakeYears: ((yearsRes?.data ?? []) as { name: string }[]).map((y) => y.name),
  };
}

/** Clears the shared cache — call after any out-of-band change to these lists (rare; Settings changes take effect on next page load). */
export function invalidateApplicationReferenceData() {
  cache = null;
  inFlight = null;
}

// `enabled` lets sheets that only fetch while open (add-application-sheet.tsx,
// add-application-to-lead-sheet.tsx) pass `open` here instead of fetching the
// moment they mount off-screen. The always-visible detail page passes `true`.
export function useApplicationReferenceData(enabled: boolean = true) {
  const [data, setData] = useState<ReferenceData>(cache ?? EMPTY);

  useEffect(() => {
    if (!enabled) return;
    // Always resolve through a promise — even the already-cached case — so
    // the setData call below runs as a microtask after this effect returns,
    // not synchronously within the effect body (avoids a cascading-render
    // lint violation; behavior is identical, cached data still resolves on
    // the very next tick).
    const promise = cache ? Promise.resolve(cache) : (inFlight ?? (inFlight = loadReferenceData().then((result) => {
      cache = result;
      return result;
    })));
    let cancelled = false;
    promise.then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Called after creating a new partner college inline (the "Create '...'"
  // flow) so every screen sees it immediately, not just the one that made it.
  function addPartnerCollege(name: string, country: string | null) {
    const base = cache ?? data;
    const updated: ReferenceData = {
      ...base,
      partnerColleges: [...base.partnerColleges, { name, country }].sort((a, b) => a.name.localeCompare(b.name)),
    };
    cache = updated;
    setData(updated);
  }

  return { ...data, addPartnerCollege };
}
