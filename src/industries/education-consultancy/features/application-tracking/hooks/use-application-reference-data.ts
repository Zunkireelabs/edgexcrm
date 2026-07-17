"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

export interface AgentOption {
  id: string;
  name: string;
  agent_type: "agent" | "super_agent";
}

export interface PartnerCollegeOption {
  id: string;
  name: string;
  country: string | null;
}

export interface ProgramOption {
  id: string;
  university_id: string;
  name: string;
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

// A brand-new (or not-yet-configured) tenant has zero rows in Settings'
// destination-countries list. Without a fallback, the Country picker on all
// 3 Add Application screens goes dead — no options, can't tag a country,
// can't country-filter the university picker. This is the same 14-country
// list every screen hardcoded before Settings-managed countries existed.
const FALLBACK_COUNTRIES = [
  "Australia",
  "Canada",
  "China",
  "France",
  "Germany",
  "India",
  "Japan",
  "Nepal",
  "New Zealand",
  "Singapore",
  "UAE",
  "United Kingdom",
  "United States",
  "Other",
];

// Shared by all 3 Add Application screens. Ranks colleges tagged to the
// selected country (plus untagged colleges) first, but — unlike a hard
// filter — NEVER drops a college from the list outright. A college tagged to
// a different country must stay selectable/dedupe-able here, or the
// AutocompleteInput's exact-match check can't see it, offers "Create" for a
// name that already exists, and the create POST 409s on the tenant+name
// unique constraint with no way to recover.
export function getCollegeSuggestions(colleges: PartnerCollegeOption[], country: string): string[] {
  if (!country) return colleges.map((c) => c.name);
  return [...colleges]
    .sort((a, b) => {
      const aMatch = a.country === country || !a.country;
      const bMatch = b.country === country || !b.country;
      return aMatch === bMatch ? 0 : aMatch ? -1 : 1;
    })
    .map((c) => c.name);
}

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
// Bumped by any local mutation (addPartnerCollege) so a slow background load
// that resolves afterward can tell it's stale and must not clobber the cache.
let cacheVersion = 0;
// Every mounted hook instance's setData, so a mutation from ANY one of them
// (e.g. the "Create college" flow on the standalone board's sheet) repaints
// every other co-mounted screen (e.g. the lead-scoped sheet open at the same
// time) immediately, instead of only the instance that made the change —
// the others would otherwise show the new college only after next remount.
const subscribers = new Set<(data: ReferenceData) => void>();
function broadcast(data: ReferenceData) {
  subscribers.forEach((setter) => setter(data));
}

async function fetchReferenceData(): Promise<{ data: ReferenceData; failed: string[] }> {
  const [agentsRes, collegesRes, countriesRes, monthsRes, yearsRes] = await Promise.all([
    fetch("/api/v1/agents").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/partner-colleges").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/countries").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/intake-months").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/v1/intake-years").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const failed: string[] = [];
  if (!agentsRes) failed.push("agents");
  if (!collegesRes) failed.push("partner colleges");
  if (!countriesRes) failed.push("destination countries");
  if (!monthsRes) failed.push("intake months");
  if (!yearsRes) failed.push("intake years");
  if (failed.length > 0) {
    toast.error(`Failed to load ${failed.join(", ")} — try again shortly`);
  }

  return {
    data: {
      agents: (agentsRes?.data ?? []) as AgentOption[],
      partnerColleges: ((collegesRes?.data ?? []) as { id: string; name: string; country: string | null }[]).map((c) => ({
        id: c.id,
        name: c.name,
        country: c.country,
      })),
      countries: ((countriesRes?.data ?? []) as { name: string }[]).map((c) => c.name),
      intakeMonths: ((monthsRes?.data ?? []) as { name: string }[]).map((m) => m.name),
      intakeYears: ((yearsRes?.data ?? []) as { name: string }[]).map((y) => y.name),
    },
    failed,
  };
}

// Kicks off (or reuses) a shared load. On full success, caches the result. On
// any partial failure the cache is deliberately left empty so the NEXT mount
// retries instead of a transient blip getting cached as empty for the rest of
// the session. Also guards against a slow load resolving after a local
// mutation (e.g. addPartnerCollege) by checking cacheVersion before writing.
function loadReferenceData(): Promise<ReferenceData> {
  const startVersion = cacheVersion;
  const promise = fetchReferenceData().then(({ data, failed }) => {
    inFlight = null;
    if (failed.length === 0 && cacheVersion === startVersion) {
      cache = data;
    }
    return cache ?? data;
  });
  inFlight = promise;
  return promise;
}

/** Clears the shared cache — call after any out-of-band change to these lists (rare; Settings changes take effect on next page load). */
export function invalidateApplicationReferenceData() {
  cache = null;
  inFlight = null;
  cacheVersion++;
}

// ── Programs cache (keyed by university_id) ─────────────────────────────────
const programsCache = new Map<string, ProgramOption[]>();
const programsInFlight = new Map<string, Promise<ProgramOption[]>>();
const programSubscribers = new Set<(universityId: string, programs: ProgramOption[]) => void>();
function broadcastPrograms(universityId: string, programs: ProgramOption[]) {
  programSubscribers.forEach((setter) => setter(universityId, programs));
}

async function fetchProgramsForUniversity(universityId: string): Promise<ProgramOption[]> {
  const res = await fetch(`/api/v1/study-programs?university_id=${universityId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as ProgramOption[];
}

function loadPrograms(universityId: string): Promise<ProgramOption[]> {
  const promise = fetchProgramsForUniversity(universityId).then((result) => {
    programsInFlight.delete(universityId);
    programsCache.set(universityId, result);
    return result;
  });
  programsInFlight.set(universityId, promise);
  return promise;
}

// `enabled` lets sheets that only fetch while open (add-application-sheet.tsx,
// add-application-to-lead-sheet.tsx) pass `open` here instead of fetching the
// moment they mount off-screen. The always-visible detail page passes `true`.
export function useApplicationReferenceData(enabled: boolean = true) {
  const [data, setData] = useState<ReferenceData>(cache ?? EMPTY);
  // Distinct from "data is EMPTY" — EMPTY is also the shape of a tenant that
  // genuinely has zero countries/months/years configured. `loaded` only
  // becomes true once a real fetch (or an already-populated cache) has been
  // observed, so the Country fallback below can tell "still loading" apart
  // from "confirmed empty" instead of treating both the same.
  const [loaded, setLoaded] = useState(cache !== null);

  useEffect(() => {
    subscribers.add(setData);
    return () => {
      subscribers.delete(setData);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Always resolve through a promise — even the already-cached case — so
    // the setData call below runs as a microtask after this effect returns,
    // not synchronously within the effect body (avoids a cascading-render
    // lint violation; behavior is identical, cached data still resolves on
    // the very next tick).
    const promise = cache ? Promise.resolve(cache) : (inFlight ?? loadReferenceData());
    let cancelled = false;
    promise.then((result) => {
      if (!cancelled) {
        setData(result);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Called after creating a new partner college inline (the "Create '...'"
  // flow) so every screen sees it immediately, not just the one that made it —
  // broadcasts to every mounted hook instance, not only this one's own state.
  // Always merges onto the REAL loaded reference data, never a synthesized-
  // from-EMPTY snapshot — writing an incomplete object into `cache` here
  // would permanently block the real, in-flight fetch result from ever
  // landing (the same failure mode loadReferenceData's cacheVersion guard
  // exists to prevent for a stale write).
  async function addPartnerCollege(id: string, name: string, country: string | null) {
    const loadedData = cache ?? (await (inFlight ?? loadReferenceData()));
    const updated: ReferenceData = {
      ...loadedData,
      partnerColleges: [...loadedData.partnerColleges, { id, name, country }].sort((a, b) => a.name.localeCompare(b.name)),
    };
    // Only persist to the shared cache if the underlying load actually
    // succeeded in full (cache is non-null after the await) — a
    // partial-failure load deliberately leaves `cache` null so the next
    // mount retries; don't make that failure permanent by caching an
    // incomplete object here. Every currently-mounted screen still sees the
    // new college immediately via broadcast either way.
    if (cache) {
      cache = updated;
      cacheVersion++;
    }
    broadcast(updated);
  }

  // Creates a partner college on the server, then applies it to the shared
  // cache so every mounted Add Application screen sees it immediately. Single
  // home for the "Create '...'" autocomplete flow used by all 3 screens.
  // Returns the created record (truthy — existing `if (ok)` call sites keep working
  // unchanged) so callers that need the new id (e.g. to filter/create Programs under
  // this University) can read it without racing this hook's own stale-closure state.
  async function createPartnerCollege(name: string, country: string | null): Promise<PartnerCollegeOption | null> {
    try {
      const res = await fetch("/api/v1/partner-colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, country }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Failed to create college");
      }
      const json = await res.json();
      const created = json.data as { id: string; name: string; country: string | null };
      await addPartnerCollege(created.id, created.name, created.country);
      toast.success(`"${name}" added to partner colleges${country ? ` (${country})` : ""}`);
      return { id: created.id, name: created.name, country: created.country };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create college");
      return null;
    }
  }

  // ── Programs (tied to a University) ───────────────────────────────────────
  // Unlike partnerColleges/countries/etc, programs are NOT prefetched — keyed by
  // university_id and fetched on demand (a tenant may have many universities, each
  // with its own program list). Still module-level cached so switching between two
  // already-viewed universities within a session doesn't re-fetch.
  const [programsByUniversity, setProgramsByUniversity] = useState<Record<string, ProgramOption[]>>({});

  useEffect(() => {
    const handler = (universityId: string, programs: ProgramOption[]) => {
      setProgramsByUniversity((prev) => ({ ...prev, [universityId]: programs }));
    };
    programSubscribers.add(handler);
    return () => {
      programSubscribers.delete(handler);
    };
  }, []);

  async function fetchPrograms(universityId: string): Promise<ProgramOption[]> {
    if (!universityId) return [];
    const cached = programsCache.get(universityId);
    if (cached) {
      setProgramsByUniversity((prev) => ({ ...prev, [universityId]: cached }));
      return cached;
    }
    const result = await (programsInFlight.get(universityId) ?? loadPrograms(universityId));
    setProgramsByUniversity((prev) => ({ ...prev, [universityId]: result }));
    return result;
  }

  // Creates a program under a University on the server, then applies it to the
  // shared cache so every mounted screen watching this university sees it
  // immediately — mirrors createPartnerCollege above.
  async function createProgram(universityId: string, name: string): Promise<ProgramOption | null> {
    try {
      const res = await fetch("/api/v1/study-programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ university_id: universityId, name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Failed to create program");
      }
      const json = await res.json();
      const created = json.data as ProgramOption;
      const existing = programsCache.get(universityId) ?? [];
      const updated = [...existing.filter((p) => p.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name));
      programsCache.set(universityId, updated);
      broadcastPrograms(universityId, updated);
      toast.success(`"${name}" added to programs`);
      return created;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create program");
      return null;
    }
  }

  // Distinct program names across the whole tenant (not scoped to a university) — the
  // multi-select source for "Add University with Programs". Not cached (opened rarely,
  // via the University create-new flow only) — a plain fetch is enough.
  async function fetchDistinctProgramNames(): Promise<string[]> {
    try {
      const res = await fetch("/api/v1/study-programs?distinct_names=true");
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as string[];
    } catch {
      return [];
    }
  }

  return {
    ...data,
    // Only substitute the generic fallback once a real fetch has confirmed
    // the tenant's list is actually empty — not during the loading window,
    // where a tenant with real configured countries would otherwise
    // transiently show (and let an admin pick from) the wrong list.
    countries: !loaded ? [] : data.countries.length > 0 ? data.countries : FALLBACK_COUNTRIES,
    addPartnerCollege,
    createPartnerCollege,
    programsByUniversity,
    fetchPrograms,
    createProgram,
    fetchDistinctProgramNames,
  };
}
