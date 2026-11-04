import { toast } from "sonner";

/**
 * Opens an application file in a new tab from the Activity feed. Same flow as the file chip on the application's
 * Notes tab: ask the server for a short-lived link (it checks the caller's access and logs the download), then open it.
 */
export async function openFeedDocument(documentId: string): Promise<void> {
  try {
    const res = await fetch(`/api/v1/documents/${documentId}/download-url`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.data?.url) {
      toast.error(json?.error?.message ?? "Failed to open document");
      return;
    }
    window.open(json.data.url as string, "_blank", "noopener,noreferrer");
  } catch {
    toast.error("Failed to open document");
  }
}
