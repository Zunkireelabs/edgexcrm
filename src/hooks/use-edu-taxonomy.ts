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
  /** "Interested Study Level" options — sourced from the study_levels catalog,
   *  falling back to the DEGREE_LEVELS labels until the catalog loads/if empty. */
  studyLevels: string[];
  loading: boolean;
}

export function useEduTaxonomy(): EduTaxonomy {
  const [destinations, setDestinations] = useState<string[]>([...DESTINATIONS]);
  const [fieldsOfStudy, setFieldsOfStudy] = useState<string[]>([...FIELDS_OF_STUDY]);
  const [studyLevels, setStudyLevels] = useState<string[]>(DEGREE_LEVELS.map((d) => d.label));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/countries").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/courses").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/study-levels").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([countriesRes, coursesRes, studyLevelsRes]) => {
        if (cancelled) return;
        const countries: { name: string }[] = countriesRes.data ?? [];
        const courses: { name: string }[] = coursesRes.data ?? [];
        const levels: { name: string }[] = studyLevelsRes.data ?? [];
        if (countries.length > 0) setDestinations(countries.map((c) => c.name));
        if (courses.length > 0) setFieldsOfStudy(courses.map((c) => c.name));
        if (levels.length > 0) setStudyLevels(levels.map((l) => l.name));
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
  }, []);

  return { destinations, fieldsOfStudy, studyLevels, loading };
}
