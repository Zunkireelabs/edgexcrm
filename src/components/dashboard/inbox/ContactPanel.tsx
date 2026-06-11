"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { User, Phone, ExternalLink, UserPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type ConversationRow = Record<string, unknown>;

interface LeadData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage_id: string | null;
}

interface ContactPanelProps {
  conversation: ConversationRow | null;
  tenantId: string;
  onConversationUpdate: () => void;
}

export function ContactPanel({ conversation, tenantId: _tenantId, onConversationUpdate }: ContactPanelProps) {
  const [lead, setLead] = useState<LeadData | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);

  const leadId = conversation?.lead_id as string | null;
  const displayName = (conversation?.contact_display_name as string | null)
    ?? (conversation?.contact_phone as string | null)
    ?? "Unknown contact";

  useEffect(() => {
    let cancelled = false;
    if (!leadId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLead(null);
      return;
    }
    setLoadingLead(true);
    fetch(`/api/v1/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setLead(json?.data ?? null); })
      .catch(() => { if (!cancelled) setLead(null); })
      .finally(() => { if (!cancelled) setLoadingLead(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  const handleConvertToLead = async () => {
    if (!conversation) return;
    const phone = conversation.contact_phone as string | null;
    const name = conversation.contact_display_name as string | null;
    const nameParts = name ? name.split(" ") : ["Unknown"];
    const firstName = nameParts[0] ?? "Unknown";
    const lastName = nameParts.slice(1).join(" ") || null;

    const res = await fetch("/api/v1/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        phone: phone ?? undefined,
        is_final: true,
      }),
    });

    if (!res.ok) {
      toast.error("Failed to create lead");
      return;
    }

    const json = await res.json() as { data: { id: string } };
    const newLeadId = json.data?.id;
    if (!newLeadId) return;

    // Link conversation to new lead
    const convId = conversation.id as string;
    await fetch(`/api/v1/inbox/conversations/${convId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: newLeadId }),
    });

    toast.success("Lead created and linked");
    onConversationUpdate();
  };

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-1 px-4">
        <User className="w-8 h-8 opacity-30" />
        <p>Select a conversation</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Contact header */}
      <div className="p-4 border-b">
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <User className="w-6 h-6 text-gray-400" />
          </div>
          <p className="font-semibold text-sm text-center">{displayName}</p>
          {(conversation.contact_phone as string | null) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="w-3 h-3" />
              <span>{conversation.contact_phone as string}</span>
            </div>
          )}
          <Badge variant="outline" className="text-xs">
            {conversation.provider as string}
          </Badge>
        </div>
      </div>

      {/* Lead linkage */}
      <div className="p-4 border-b">
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
          Linked Lead
        </p>

        {loadingLead ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Loading…
          </div>
        ) : lead ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">
              {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead"}
            </p>
            {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
            {lead.phone && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="w-3 h-3" />
                <span>{lead.phone}</span>
              </div>
            )}
            <Link
              href={`/leads/${lead.id}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              View lead <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Not linked to a lead</p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-7 gap-1"
              onClick={handleConvertToLead}
            >
              <UserPlus className="w-3 h-3" />
              Convert to lead
            </Button>
          </div>
        )}
      </div>

      {/* Conversation metadata */}
      <div className="p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
          Conversation
        </p>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {conversation.status as string}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">AI mode</span>
            <span className="text-foreground">{conversation.ai_autonomy as string}</span>
          </div>
          {(conversation.stage_tag as string | null) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stage</span>
              <span className="text-foreground">{conversation.stage_tag as string}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
