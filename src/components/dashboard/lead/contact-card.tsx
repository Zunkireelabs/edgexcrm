"use client";

import { Mail, Phone, MessageSquare, CheckSquare, MoreHorizontal, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "sonner";
import type { Lead, PipelineStage } from "@/types/database";

interface ContactCardProps {
  lead: Lead;
  currentStage?: PipelineStage;
  onNoteClick?: () => void;
  onTaskClick?: () => void;
}

function getInitials(firstName: string | null, lastName: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}

interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

function QuickActionButton({ icon, label, onClick, disabled }: QuickActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 group disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground group-disabled:hover:border-border group-disabled:hover:text-muted-foreground transition-colors">
        {icon}
      </span>
      <span className="text-xs text-muted-foreground group-hover:text-foreground group-disabled:hover:text-muted-foreground transition-colors">
        {label}
      </span>
    </button>
  );
}

export function ContactCard({ lead, currentStage, onNoteClick, onTaskClick }: ContactCardProps) {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
  const initials = getInitials(lead.first_name, lead.last_name);
  const stageColor = currentStage?.color || "#6b7280";

  const handleEmailClick = () => {
    if (lead.email) {
      window.location.href = `mailto:${lead.email}`;
    }
  };

  const handleCallClick = () => {
    if (lead.phone) {
      window.location.href = `tel:${lead.phone}`;
    }
  };

  const handleWhatsAppClick = () => {
    if (lead.phone) {
      const cleanPhone = lead.phone.replace(/[^0-9]/g, "");
      window.open(`https://wa.me/${cleanPhone}`, "_blank");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <Card className="border border-border shadow-none rounded-lg py-0">
      <CardContent className="p-4">
        {/* Avatar and Name */}
        <div className="flex flex-col items-center text-center mb-4">
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: `${stageColor}15` }}
          >
            <span className="text-lg font-semibold" style={{ color: stageColor }}>
              {initials}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">{fullName}</h2>
          {currentStage && (
            <Badge
              variant="secondary"
              className="mt-2"
              style={{
                backgroundColor: `${stageColor}20`,
                color: stageColor,
              }}
            >
              {currentStage.name}
            </Badge>
          )}
        </div>

        {/* Contact Info */}
        <div className="space-y-2 mb-4">
          {lead.email && (
            <div className="flex items-center justify-between group">
              <a
                href={`mailto:${lead.email}`}
                className="text-sm text-muted-foreground hover:text-primary truncate flex-1"
              >
                {lead.email}
              </a>
              <CopyButton value={lead.email} label="Email" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {lead.phone && (
            <div className="flex items-center justify-between group">
              <a
                href={`tel:${lead.phone}`}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {lead.phone}
              </a>
              <CopyButton value={lead.phone} label="Phone" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center justify-center gap-4 pt-4 border-t border-border">
          <QuickActionButton
            icon={<MessageSquare className="h-4 w-4" />}
            label="Note"
            onClick={onNoteClick}
          />
          <QuickActionButton
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            onClick={handleEmailClick}
            disabled={!lead.email}
          />
          <QuickActionButton
            icon={<Phone className="h-4 w-4" />}
            label="Call"
            onClick={handleCallClick}
            disabled={!lead.phone}
          />
          <QuickActionButton
            icon={<CheckSquare className="h-4 w-4" />}
            label="Task"
            onClick={onTaskClick}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center gap-1 group"
              >
                <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">More</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyLink}>
                Copy link
              </DropdownMenuItem>
              {lead.phone && (
                <DropdownMenuItem onClick={handleWhatsAppClick}>
                  <MessageCircle className="h-4 w-4 mr-2" />
                  WhatsApp
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
