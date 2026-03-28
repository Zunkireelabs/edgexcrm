"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { ActivityType, CallOutcome, LeadActivityRecord } from "@/types/database";

interface LogActivityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  activityType: ActivityType;
  onActivityLogged: (activity: LeadActivityRecord) => void;
}

const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "left_voicemail", label: "Left Voicemail" },
  { value: "no_answer", label: "No Answer" },
  { value: "busy", label: "Busy" },
  { value: "wrong_number", label: "Wrong Number" },
];

export function LogActivityModal({
  open,
  onOpenChange,
  leadId,
  activityType,
  onActivityLogged,
}: LogActivityModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Common fields
  const [description, setDescription] = useState("");

  // Call fields
  const [callOutcome, setCallOutcome] = useState<CallOutcome>("connected");
  const [duration, setDuration] = useState("");

  // Email fields
  const [emailSubject, setEmailSubject] = useState("");

  // Meeting fields
  const [meetingSubject, setMeetingSubject] = useState("");
  const [location, setLocation] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const resetForm = () => {
    setDescription("");
    setCallOutcome("connected");
    setDuration("");
    setEmailSubject("");
    setMeetingSubject("");
    setLocation("");
    setScheduledDate("");
    setScheduledTime("");
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        activity_type: activityType,
        description: description || null,
      };

      if (activityType === "call") {
        payload.call_outcome = callOutcome;
        payload.duration_minutes = duration ? parseInt(duration) : null;
        payload.subject = `Call - ${CALL_OUTCOMES.find(o => o.value === callOutcome)?.label}`;
      } else if (activityType === "email") {
        payload.email_subject = emailSubject || null;
        payload.subject = emailSubject || "Email logged";
      } else if (activityType === "meeting") {
        payload.subject = meetingSubject || "Meeting";
        payload.location = location || null;
        if (scheduledDate && scheduledTime) {
          payload.scheduled_at = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
        } else if (scheduledDate) {
          payload.scheduled_at = new Date(scheduledDate).toISOString();
        }
      }

      const res = await fetch(`/api/v1/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to log activity");
      }

      const json = await res.json();
      onActivityLogged(json.data);
      toast.success(`${getActivityLabel(activityType)} logged successfully`);
      resetForm();
      onOpenChange(false);
    } catch {
      toast.error("Failed to log activity");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getActivityLabel = (type: ActivityType) => {
    switch (type) {
      case "call": return "Call";
      case "email": return "Email";
      case "meeting": return "Meeting";
    }
  };

  const getTitle = () => {
    switch (activityType) {
      case "call": return "Log Call";
      case "email": return "Log Email";
      case "meeting": return "Log Meeting";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Call-specific fields */}
          {activityType === "call" && (
            <>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={callOutcome} onValueChange={(v) => setCallOutcome(v as CallOutcome)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUTCOMES.map((outcome) => (
                      <SelectItem key={outcome.value} value={outcome.value}>
                        {outcome.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  placeholder="e.g., 15"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  min="0"
                />
              </div>
            </>
          )}

          {/* Email-specific fields */}
          {activityType === "email" && (
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder="Email subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>
          )}

          {/* Meeting-specific fields */}
          {activityType === "meeting" && (
            <>
              <div className="space-y-2">
                <Label>Meeting Title</Label>
                <Input
                  placeholder="e.g., Discovery Call"
                  value={meetingSubject}
                  onChange={(e) => setMeetingSubject(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Time</Label>
                  <Input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input
                  placeholder="e.g., Zoom, Office"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Notes (common to all) */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Add any notes about this activity..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Log Activity
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
