// A tiny signal so every place that shows a lead's stored lists (the Student Details pop-up, and the read-only card on the lead page)
// reloads after one of them saves. Same idea as applicant-documents/documents-events.ts.

export const STUDENT_RECORD_CHANGED_EVENT = "student-record:changed";

export function notifyStudentRecordChanged(leadId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STUDENT_RECORD_CHANGED_EVENT, { detail: { leadId } }));
}

/** Runs `callback` whenever the stored lists change for THIS lead. Returns the unsubscribe. */
export function onStudentRecordChanged(leadId: string, callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const changed = (event as CustomEvent<{ leadId?: string }>).detail?.leadId;
    if (!changed || changed === leadId) callback();
  };
  window.addEventListener(STUDENT_RECORD_CHANGED_EVENT, handler);
  return () => window.removeEventListener(STUDENT_RECORD_CHANGED_EVENT, handler);
}
