// A tiny signal so the Documents card on the page refreshes when documents are added from somewhere else on the
// page — e.g. the "Attach" button inside the Student Details pop-up, which sits in front of that card. Without it the
// counselor attaches five files and the card behind keeps showing the old list until a reload.

export const DOCUMENTS_CHANGED_EVENT = "applicant-documents:changed";

export function notifyDocumentsChanged(leadId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOCUMENTS_CHANGED_EVENT, { detail: { leadId } }));
}

/** Runs `callback` whenever documents change for THIS lead (other students' changes are ignored). Returns the unsubscribe. */
export function onDocumentsChanged(leadId: string, callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const changed = (event as CustomEvent<{ leadId?: string }>).detail?.leadId;
    if (!changed || changed === leadId) callback();
  };
  window.addEventListener(DOCUMENTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DOCUMENTS_CHANGED_EVENT, handler);
}
