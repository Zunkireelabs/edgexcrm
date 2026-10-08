/**
 * Options for the "Intake" filter: every "Month Year" combination, in time order
 * (Jan 2026 … Dec 2026, Jan 2027 …). Year-major, so a month never repeats across every year
 * before the next month starts. `months` / `years` come from the Settings catalogs, which are
 * already stored in calendar / ascending order. The joined "Month Year" string is the exact
 * value the Add Lead sheet writes to `leads.intake_term`.
 */
export function buildIntakeTermOptions(
  months: readonly string[],
  years: readonly string[],
): { value: string; label: string }[] {
  return years.flatMap((year) =>
    months.map((month) => {
      const value = `${month} ${year}`;
      return { value, label: value };
    }),
  );
}
