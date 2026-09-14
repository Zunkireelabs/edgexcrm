"use client";

import { useState, useEffect } from "react";
import {
  DESTINATIONS,
  FIELDS_OF_STUDY,
  DEGREE_LEVELS,
} from "@/industries/_shared/features/lead-lists/taxonomies";

interface EduTaxonomy {
  destinations: string[];
  fieldsOfStudy: string[];
  /** "Interested Degree Level" options — sourced from the study_levels catalog,
   *  falling back to the DEGREE_LEVELS labels until the catalog loads/if empty. */
  studyLevels: string[];
  /** Same intake_months/intake_years catalogs Applications already uses
   *  (migration 139) — no lead-specific catalog, shared list. */
  intakeMonths: string[];
  intakeYears: string[];
  loading: boolean;
}

export function useEduTaxonomy(options?: { enabled?: boolean }): EduTaxonomy {
  // `enabled` (default true, so every pre-existing caller is unaffected) lets a
  // universal/shared consumer — e.g. leads-table.tsx, used by every industry, not
  // just education_consultancy — skip firing these three fetches entirely instead
  // of hitting three routes that are gated to APPLICATION_TRACKING (education_
  // consultancy only, see courses/study-levels/countries routes) and 403 for
  // every other tenant on every leads-table mount.
  const enabled = options?.enabled ?? true;
  const [destinations, setDestinations] = useState<string[]>([...DESTINATIONS]);
  const [fieldsOfStudy, setFieldsOfStudy] = useState<string[]>([...FIELDS_OF_STUDY]);
  const [studyLevels, setStudyLevels] = useState<string[]>(DEGREE_LEVELS.map((d) => d.label));
  const [intakeMonths, setIntakeMonths] = useState<string[]>([]);
  const [intakeYears, setIntakeYears] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No setState here for the disabled branch — react-hooks/set-state-in-effect
    // flags a synchronous setState in an effect body. `loading` below is derived
    // as `enabled && loading` at the return statement instead, so a
    // disabled/never-fetching caller reports not-loading without this effect
    // ever needing to touch state for that case.
    if (!enabled) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/countries").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/courses").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/study-levels").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/intake-months").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/intake-years").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([countriesRes, coursesRes, studyLevelsRes, intakeMonthsRes, intakeYearsRes]) => {
        if (cancelled) return;
        const countries: { name: string }[] = countriesRes.data ?? [];
        const courses: { name: string }[] = coursesRes.data ?? [];
        const levels: { name: string }[] = studyLevelsRes.data ?? [];
        const months: { name: string }[] = intakeMonthsRes.data ?? [];
        const years: { name: string }[] = intakeYearsRes.data ?? [];
        if (countries.length > 0) setDestinations(countries.map((c) => c.name));
        if (courses.length > 0) setFieldsOfStudy(courses.map((c) => c.name));
        if (levels.length > 0) setStudyLevels(levels.map((l) => l.name));
        if (months.length > 0) setIntakeMonths(months.map((m) => m.name));
        if (years.length > 0) setIntakeYears(years.map((y) => y.name));
      })
      .catch(() => {
        // keep hardcoded fallback values
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { destinations, fieldsOfStudy, studyLevels, intakeMonths, intakeYears, loading: enabled && loading };
}
