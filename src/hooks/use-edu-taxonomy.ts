"use client";

import { useState, useEffect } from "react";
import {
  DESTINATIONS,
  FIELDS_OF_STUDY,
} from "@/industries/_shared/features/lead-lists/taxonomies";

interface EduTaxonomy {
  destinations: string[];
  fieldsOfStudy: string[];
  loading: boolean;
}

export function useEduTaxonomy(): EduTaxonomy {
  const [destinations, setDestinations] = useState<string[]>([...DESTINATIONS]);
  const [fieldsOfStudy, setFieldsOfStudy] = useState<string[]>([...FIELDS_OF_STUDY]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/countries").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/courses").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([countriesRes, coursesRes]) => {
        if (cancelled) return;
        const countries: { name: string }[] = countriesRes.data ?? [];
        const courses: { name: string }[] = coursesRes.data ?? [];
        if (countries.length > 0) setDestinations(countries.map((c) => c.name));
        if (courses.length > 0) setFieldsOfStudy(courses.map((c) => c.name));
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

  return { destinations, fieldsOfStudy, loading };
}
