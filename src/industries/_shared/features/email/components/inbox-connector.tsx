"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConnectedInboxes } from "../hooks/use-connected-inboxes";

export function InboxConnector() {
  const { inboxes, loading, refresh: fetchInboxes } = useConnectedInboxes();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Handle OAuth callback redirect params
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      toast.success(`Connected ${decodeURIComponent(connected)}`);
      fetchInboxes();
      // Remove query param without full reload
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      router.replace(url.pathname + url.search + "#connected-inboxes");
    } else if (error) {
      toast.error(`Failed to connect inbox: ${error}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      router.replace(url.pathname + url.search + "#connected-inboxes");
    }
  }, [searchParams, fetchInboxes, router]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/v1/email/inboxes/connect", { method: "POST" });
      if (!res.ok) {
        toast.error("Could not start Gmail connection");
        return;
      }
      const { data } = await res.json();
      window.location.href = data.url;
    } catch {
      toast.error("Could not start Gmail connection");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    setDisconnecting(id);
    try {
      const res = await fetch(`/api/v1/email/inboxes/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchInboxes();
        toast.success("Inbox disconnected");
      } else {
        toast.error("Could not disconnect inbox");
      }
    } catch {
      toast.error("Could not disconnect inbox");
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div
      id="connected-inboxes"
      className="border border-border bg-card rounded-lg shadow-none p-3 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Connected Inboxes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send emails from CRM using your own Gmail. Connect one or more accounts; pick the From
            address at compose time.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={connecting}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
        >
          {connecting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Connect a Gmail inbox
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : inboxes.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No inboxes connected yet. Connect your first Gmail account to send emails from CRM.
        </p>
      ) : (
        <ul className="space-y-2">
          {inboxes.map((inbox) => {
            const broken = inbox.health === "error";
            return (
              <li
                key={inbox.id}
                className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                  broken ? "border-amber-200 bg-amber-50" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {broken ? (
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  ) : (
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{inbox.email}</p>
                      {broken && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                        >
                          Needs reconnect
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {broken
                        ? "Connection broken — reconnect this Gmail account to resume sending and receiving replies."
                        : `${inbox.provider} · Connected ${new Date(inbox.created_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {broken && (
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={connecting}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Reconnect
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disconnecting === inbox.id}
                    onClick={() => handleDisconnect(inbox.id)}
                  >
                    {disconnecting === inbox.id && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    Disconnect
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
