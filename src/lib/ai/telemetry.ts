// Phase 1A: no-op tracing seam. 1C wires Langfuse behind this SAME interface — callers never change.
export interface Trace {
  span(name: string, data?: Record<string, unknown>): void;
  end(data?: Record<string, unknown>): void;
}

export function startTrace(_meta: {
  runId: string;
  tenantId: string;
  userId?: string;
  industryId: string | null;
  surface: string;
}): Trace {
  return { span() {}, end() {} };
}
