import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import {
  SOURCE_KINDS,
  cleanOptionLabel,
  isSourceKind,
  mergeSourceOptions,
  slugifyOption,
  type SourceKind,
  type SourceOption,
} from "@/lib/leads/source-options";

type Row = { kind: SourceKind; value: string; label: string };

async function loadExtras(db: Awaited<ReturnType<typeof scopedClient>>): Promise<{ rows: Row[]; failed: boolean }> {
  const { data, error } = await db.from("lead_source_options").select("kind, value, label").order("created_at", { ascending: true });
  if (error) return { rows: [], failed: true };
  return { rows: ((data ?? []) as unknown as Row[]).filter((r) => isSourceKind(r.kind)), failed: false };
}

function listsFrom(rows: Row[]): Record<SourceKind, SourceOption[]> {
  const out = {} as Record<SourceKind, SourceOption[]>;
  for (const kind of SOURCE_KINDS) {
    out[kind] = mergeSourceOptions(kind, rows.filter((r) => r.kind === kind));
  }
  return out;
}

/** The three Source dropdown lists for this tenant: the starting options plus what an admin has added. */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { rows, failed } = await loadExtras(db);
  // If the additions table cannot be read, still hand back the starting lists: the dropdowns keep working.
  if (failed) return apiSuccess(listsFrom([]));
  return apiSuccess(listsFrom(rows));
}

/** Owner/admin adds one option to one list. Adding something that already exists just returns the existing option. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/lead-source-options" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!isSourceKind(body.kind)) return apiValidationError({ kind: ["kind must be category, channel or account"] });
  const kind = body.kind;
  const label = cleanOptionLabel(body.label);
  if (!label) return apiValidationError({ label: ["Enter a name of 1 to 60 characters"] });
  const value = slugifyOption(label);
  if (!value) return apiValidationError({ label: ["Use letters or numbers in the name"] });

  const db = await scopedClient(auth);
  const { rows, failed } = await loadExtras(db);
  if (failed) return apiError("DB_ERROR", "Failed to read the options", 500);

  const existing = mergeSourceOptions(kind, rows.filter((r) => r.kind === kind)).find(
    (o) => o.value.toLowerCase() === value || o.label.toLowerCase() === label.toLowerCase(),
  );
  if (existing) return apiSuccess({ kind, ...existing, created: false });

  const { error } = await db.from("lead_source_options").insert({ kind, value, label, created_by: auth.userId });
  if (error) {
    // Two admins adding the same option at once: the second is a duplicate, not a failure.
    if (error.code === "23505") return apiSuccess({ kind, value, label, created: false });
    log.error({ error }, "Failed to add lead source option");
    return apiError("DB_ERROR", "Failed to add the option", 500);
  }

  log.info({ kind, value }, "Lead source option added");
  return apiSuccess({ kind, value, label, created: true }, 201);
}
