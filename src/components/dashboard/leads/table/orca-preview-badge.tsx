// The "Preview" pill on the "Next step · Orca" column header (approved leads-table-v2 mockup).
// Every AI-toned surface of the Leads table lives in this one file (see ai-gradient-guard.test.ts).
export function OrcaPreviewBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-ds-ai-soft px-1.5 text-[11px] font-medium leading-4 text-ds-ai">{children}</span>
  );
}
