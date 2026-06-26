"use client";

import { Loader2 } from "lucide-react";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useConnectedInboxes } from "../hooks/use-connected-inboxes";

interface FromAccountPickerProps {
  value: string;
  onChange: (accountId: string) => void;
}

export function FromAccountPicker({ value, onChange }: FromAccountPickerProps) {
  const { inboxes, loading } = useConnectedInboxes();
  const { openSettings } = useSettingsModal();

  if (loading) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">From</Label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground h-9 px-3 border rounded-md">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading inboxes…
        </div>
      </div>
    );
  }

  if (inboxes.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">From</Label>
        <div className="h-9 px-3 border rounded-md flex items-center bg-muted/50">
          <span className="text-sm text-muted-foreground">No inboxes connected</span>
        </div>
        <p className="text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => openSettings("communications")}
            className="text-primary hover:underline"
          >
            Connect a Gmail inbox in Settings
          </button>{" "}
          to send emails from CRM.
        </p>
      </div>
    );
  }

  const displayLabel = (email: string, displayName: string | null) =>
    displayName ? `${displayName} <${email}>` : email;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">From</Label>
      <Select
        value={value || inboxes[0].id}
        onValueChange={onChange}
        disabled={inboxes.length === 1}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inboxes.map((inbox) => (
            <SelectItem key={inbox.id} value={inbox.id}>
              {displayLabel(inbox.email, inbox.display_name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
