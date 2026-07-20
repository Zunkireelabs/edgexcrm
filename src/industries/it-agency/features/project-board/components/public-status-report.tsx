export interface PublicStatusReportBranding {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
}

export interface PublicStatusReportData {
  project_name: string;
  report_date: string;
  health_snapshot: "green" | "amber" | "red" | null;
  pct_complete_snapshot: number | null;
  summary: string | null;
  accomplishments: string | null;
  in_progress: string | null;
  risks: string | null;
  asks: string | null;
  client_message: string | null;
}

interface PublicStatusReportProps {
  report: PublicStatusReportData;
  branding?: PublicStatusReportBranding | null;
}

const HEALTH_LABEL: Record<string, string> = { green: "On track", amber: "At risk", red: "Off track" };
const HEALTH_DOT: Record<string, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };

const SECTION_FIELDS: { key: keyof PublicStatusReportData; label: string }[] = [
  { key: "accomplishments", label: "Accomplishments" },
  { key: "in_progress", label: "In progress" },
  { key: "risks", label: "Risks" },
  { key: "asks", label: "Asks" },
  { key: "client_message", label: "Message from the team" },
];

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function PublicStatusReport({ report, branding }: PublicStatusReportProps) {
  const accent = branding?.primary_color ?? undefined;
  const sections = SECTION_FIELDS.filter((f) => report[f.key]);

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 print:py-0 print:px-0">
      {branding && (
        <div className="flex items-center gap-3 mb-8 pb-4 border-b" style={accent ? { borderColor: accent } : undefined}>
          {branding.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.name} className="h-8 w-auto" />
          ) : (
            <span className="text-lg font-bold" style={accent ? { color: accent } : undefined}>
              {branding.name}
            </span>
          )}
        </div>
      )}

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{report.project_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">Status report · {formatDate(report.report_date)}</p>
        </div>
        <div className="text-right space-y-1">
          {report.health_snapshot && (
            <p className="text-sm font-medium flex items-center justify-end gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[report.health_snapshot]}`} />
              {HEALTH_LABEL[report.health_snapshot]}
            </p>
          )}
          {report.pct_complete_snapshot != null && (
            <p className="text-sm text-muted-foreground">{report.pct_complete_snapshot}% complete</p>
          )}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="space-y-6">
          {sections.map((f) => (
            <div key={f.key}>
              <h2 className="font-semibold text-sm mb-1">{f.label}</h2>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{report[f.key] as string}</p>
            </div>
          ))}
        </div>
      ) : report.summary ? (
        <div>
          <h2 className="font-semibold text-sm mb-1">Summary</h2>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{report.summary}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No details provided for this report.</p>
      )}
    </div>
  );
}
