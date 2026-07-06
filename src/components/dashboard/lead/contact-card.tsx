"use client";

import { useState, useEffect } from "react";
import { Mail, Phone, MessageSquare, CheckSquare, MoreHorizontal, MessageCircle, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CopyButton } from "@/components/ui/copy-button";
import { formatPhoneForTel, formatPhoneForWhatsApp } from "@/lib/phone-utils";
import { nationalityFromPhone } from "@/lib/leads/nationality";
import { toast } from "sonner";
import type { Lead, PipelineStage } from "@/types/database";
import { getLeadFullName, getLeadInitials } from "./lead-name";

interface LeadTypeOption {
  id: string;
  slug: string;
  label: string;
  is_default: boolean;
}

function LeadTypeBadge({ leadId, tags }: { leadId: string; tags: string[] }) {
  const [options, setOptions] = useState<LeadTypeOption[]>([]);
  const [currentTags, setCurrentTags] = useState(tags);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/lead-types")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (json?.data) setOptions(json.data); })
      .catch(() => {});
  }, []);

  useEffect(() => { setCurrentTags(tags); }, [tags]);

  const currentSlug = currentTags[0] ?? options.find((o) => o.is_default)?.slug ?? null;
  const currentLabel = options.find((o) => o.slug === currentSlug)?.label ?? currentSlug ?? "Student";

  async function select(slug: string) {
    if (slug === currentSlug || saving) return;
    setSaving(true);
    const prev = currentTags;
    // Preserve tail (e.g. campaign tags at index ≥1); only replace the type slot.
    const nextTags = [slug, ...currentTags.slice(1)];
    setCurrentTags(nextTags);
    setOpen(false);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Set to ${options.find((o) => o.slug === slug)?.label ?? slug}`);
    } catch {
      setCurrentTags(prev);
      toast.error("Failed to update lead type");
    } finally {
      setSaving(false);
    }
  }

  if (options.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50"
        >
          {currentLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-40 p-1">
        {options.map((opt) => (
          <button
            key={opt.slug}
            type="button"
            onClick={() => select(opt.slug)}
            className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors ${
              opt.slug === currentSlug ? "font-semibold text-blue-700" : "text-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface LeadDraftSubset {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  nationality: string;
}

interface ContactCardProps {
  lead: Lead;
  currentStage?: PipelineStage;
  onNoteClick?: () => void;
  onTaskClick?: () => void;
  isEditing?: boolean;
  draft?: LeadDraftSubset;
  editErrors?: { email?: string; phone?: string };
  onDraftChange?: (field: keyof LeadDraftSubset, value: string) => void;
  industryId?: string | null;
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
      <span className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground group-disabled:hover:border-border group-disabled:hover:text-muted-foreground transition-colors">
        {icon}
      </span>
      <span className="text-xs text-muted-foreground group-hover:text-foreground group-disabled:hover:text-muted-foreground transition-colors">
        {label}
      </span>
    </button>
  );
}

export function ContactCard({
  lead,
  currentStage,
  onNoteClick,
  onTaskClick,
  isEditing = false,
  draft,
  editErrors = {},
  onDraftChange,
  industryId,
}: ContactCardProps) {
  const fullName = isEditing && draft
    ? [draft.first_name, draft.last_name].filter(Boolean).join(" ") || "—"
    : getLeadFullName(lead);
  const initials = getLeadInitials(lead);
  const stageColor = currentStage?.color || "#6b7280";

  const handleEmailClick = () => {
    if (lead.email) {
      window.location.href = `mailto:${lead.email}`;
    }
  };

  const handleCallClick = () => {
    if (lead.phone) {
      window.location.href = `tel:${formatPhoneForTel(lead.phone)}`;
    }
  };

  const handleWhatsAppClick = () => {
    if (lead.phone) {
      window.open(`https://wa.me/${formatPhoneForWhatsApp(lead.phone)}`, "_blank");
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
          {isEditing && draft ? (
            <div className="w-full space-y-2 text-left">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">First name</p>
                  <Input
                    className="h-8 text-sm"
                    value={draft.first_name}
                    placeholder="First name"
                    onChange={(e) => onDraftChange?.("first_name", e.target.value)}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Last name</p>
                  <Input
                    className="h-8 text-sm"
                    value={draft.last_name}
                    placeholder="Last name"
                    onChange={(e) => onDraftChange?.("last_name", e.target.value)}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Email</p>
                <Input
                  className="h-8 text-sm"
                  type="email"
                  value={draft.email}
                  placeholder="email@example.com"
                  onChange={(e) => onDraftChange?.("email", e.target.value)}
                />
                {editErrors.email && (
                  <p className="text-xs text-destructive mt-1">{editErrors.email}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Phone</p>
                <Input
                  className="h-8 text-sm"
                  type="tel"
                  value={draft.phone}
                  placeholder="+977 98..."
                  onChange={(e) => onDraftChange?.("phone", e.target.value)}
                />
                {editErrors.phone && (
                  <p className="text-xs text-destructive mt-1">{editErrors.phone}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Nationality</p>
                  <Input
                    className="h-8 text-sm"
                    value={draft.nationality}
                    placeholder="e.g. Nepali"
                    onChange={(e) => onDraftChange?.("nationality", e.target.value)}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">City</p>
                  <Input
                    className="h-8 text-sm"
                    value={draft.city}
                    placeholder="Kathmandu"
                    onChange={(e) => onDraftChange?.("city", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">{fullName}</h2>
              <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                {currentStage && (
                  <Badge
                    variant="secondary"
                    style={{
                      backgroundColor: `${stageColor}20`,
                      color: stageColor,
                    }}
                  >
                    {currentStage.name}
                  </Badge>
                )}
                {industryId === "education_consultancy" && (
                  <LeadTypeBadge leadId={lead.id} tags={lead.tags ?? []} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Contact Info (read-only — inputs shown above when editing) */}
        {!isEditing && (
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
                href={`tel:${formatPhoneForTel(lead.phone)}`}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {lead.phone}
              </a>
              <CopyButton value={lead.phone} label="Phone" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {(() => {
            const nationality = lead.nationality ?? nationalityFromPhone(lead.phone);
            const city = lead.city;
            if (!nationality && !city) return null;
            return (
              <div className="flex items-center gap-1.5 pt-1">
                {nationality && (
                  <span className="text-xs text-muted-foreground">{nationality}</span>
                )}
                {nationality && city && (
                  <span className="text-xs text-muted-foreground">·</span>
                )}
                {city && (
                  <span className="text-xs text-muted-foreground">{city}</span>
                )}
              </div>
            );
          })()}
        </div>
        )}

        {/* Quick Actions (hidden in edit mode) */}
        {!isEditing && <div className="flex items-center justify-between gap-1 pt-4 border-t border-border">
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
                <span className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground transition-colors">
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
        </div>}
      </CardContent>
    </Card>
  );
}
