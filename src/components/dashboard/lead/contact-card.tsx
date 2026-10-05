"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Phone,
  MessageSquare,
  CheckSquare,
  MoreHorizontal,
  MessageCircle,
  ChevronDown,
  Pencil,
  Trash2,
  UserCheck,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CopyButton } from "@/components/ui/copy-button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { formatPhoneForTel, formatPhoneForWhatsApp } from "@/lib/phone-utils";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";
import { toast } from "sonner";
import type { Lead, PipelineStage } from "@/types/database";
import { getLeadFullName, getLeadInitials } from "./lead-name";
import { isOtherLead } from "@/lib/leads/lead-type";
import { formatDateTime } from "@/lib/date";
import { displayCase } from "@/lib/display-case";

interface LeadTypeOption {
  id: string;
  slug: string;
  label: string;
  is_default: boolean;
}

function LeadTypeBadge({
  leadId,
  tags,
  onTagChange,
}: {
  leadId: string;
  tags: string[];
  onTagChange?: (tags: string[]) => void;
}) {
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
      // Propagate up so the parent's lead state (Status/Stage gating, badges) stays
      // in sync — otherwise converting Other↔Student needs a page reload to reflect.
      onTagChange?.(nextTags);
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
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {currentLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
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
  /** Called after the Tag pill changes the lead type, so the parent can keep its
   * lead state in sync (Status/Stage gating depends on tags). */
  onTagChange?: (tags: string[]) => void;
  /** Optional section rendered inside the card, under the contact details and above the
   * quick actions (e.g. Study Interest). Hidden while editing the contact fields. */
  detailsSlot?: React.ReactNode;
  /** Back-navigation handler, rendered top-left of the card. */
  onBack?: () => void;
  /** Label for the page the back button actually returns to (e.g. "Applications",
   * "Pipeline") — shown next to the arrow so the destination isn't a guess. */
  backLabel?: string;
  /** real_estate / home_moving: shows an "Investor" badge alongside the stage badge. */
  isInvestor?: boolean;
  /** Page-level actions, folded into the card's "Action" dropdown instead of a
   * separate floating header. */
  onEdit?: () => void;
  onSave?: () => void;
  onCancelEdit?: () => void;
  isSaving?: boolean;
  saveDisabled?: boolean;
  canDelete?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  /** it_agency only: Convert to Contact entry point. */
  isItAgency?: boolean;
  convertedContactId?: string | null;
  convertedContactName?: string | null;
  onConvertClick?: () => void;
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
  onTagChange,
  detailsSlot,
  onBack,
  backLabel,
  isInvestor = false,
  onEdit,
  onSave,
  onCancelEdit,
  isSaving = false,
  saveDisabled = false,
  canDelete = false,
  onDelete,
  deleting = false,
  isItAgency = false,
  convertedContactId,
  convertedContactName,
  onConvertClick,
}: ContactCardProps) {
  const fullName = isEditing && draft
    ? [draft.first_name, draft.last_name].filter(Boolean).join(" ") || "—"
    : getLeadFullName(lead);
  const initials = getLeadInitials(lead);
  const stageColor = currentStage?.color || "#6b7280";
  const showDisplayId = industryId === "education_consultancy" && !!lead.display_id;

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
        {/* Top row: back arrow — replaces the page-level header. Status/type chips
            live under the name (see below) so they never wrap away from the identity. */}
        {(onBack || (onEdit && !isEditing)) && (
          <div className="flex items-start justify-between mb-3">
            {onBack ? (
              <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 gap-1.5" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                {backLabel && <span className="text-xs">{backLabel}</span>}
              </Button>
            ) : <span />}
            {/* The one Edit for the whole profile: turns every editable section on at once.
                Save/Cancel replace it (bottom of this card) while editing. */}
            {onEdit && !isEditing && (
              <Button variant="ghost" size="sm" className="-mr-2 h-8 px-2 gap-1.5 text-xs" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        )}

        {/* Avatar and Name */}
        <div className="flex flex-col items-start text-left mb-4">
          {showDisplayId && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600 font-medium mb-3">
              {lead.display_id}
            </span>
          )}
          {isEditing && draft ? (
            <div
              className="h-16 w-16 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: `${stageColor}15` }}
            >
              <span className="text-lg font-semibold" style={{ color: stageColor }}>
                {initials}
              </span>
            </div>
          ) : null}
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
                {industryId === "education_consultancy" ? (
                  <PhoneInput
                    value={draft.phone}
                    onChange={(v) => onDraftChange?.("phone", v)}
                    placeholder="Phone number"
                    size="sm"
                    error={!!editErrors.phone}
                  />
                ) : (
                  <Input
                    className="h-8 text-sm"
                    type="tel"
                    value={draft.phone}
                    placeholder="+977 98..."
                    onChange={(e) => onDraftChange?.("phone", e.target.value)}
                  />
                )}
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
              <div className="flex items-center gap-2.5">
                <div
                  className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${stageColor}15` }}
                >
                  <span className="text-sm font-semibold" style={{ color: stageColor }}>
                    {initials}
                  </span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{fullName}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3 empty:hidden">
                {/* Pipeline stage badge — read-only, flat. Meaningless for Other-tagged
                    walk-ins, which never enter the funnel (same gate as Key Information's
                    Status/Stage). */}
                {currentStage && !isOtherLead(lead.tags, industryId) && (
                  <Badge
                    variant="secondary"
                    className="gap-1.5 font-medium"
                    style={{
                      backgroundColor: `${stageColor}20`,
                      color: stageColor,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: stageColor }}
                      aria-hidden="true"
                    />
                    {currentStage.name}
                  </Badge>
                )}
                {industryId === "education_consultancy" && (
                  <LeadTypeBadge leadId={lead.id} tags={lead.tags ?? []} onTagChange={onTagChange} />
                )}
                {isInvestor && (
                  <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                    Investor
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Created {formatDateTime(lead.created_at)}
              </p>
            </>
          )}
        </div>

        {/* Contact Info (read-only — inputs shown above when editing) */}
        {!isEditing && (
        <div className="space-y-3 mb-4">
          {lead.email && (
            <div className="flex items-center justify-between gap-2 group">
              <a href={`mailto:${lead.email}`} className="min-w-0 flex-1 hover:text-primary">
                <TruncatedText text={lead.email} className="text-sm font-medium text-foreground" />
              </a>
              <CopyButton value={lead.email} label="Email" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {lead.phone && (
            <div className="flex items-center justify-between group">
              <a
                href={`tel:${formatPhoneForTel(lead.phone)}`}
                className="text-sm font-medium text-foreground hover:text-primary"
              >
                {lead.phone}
              </a>
              <CopyButton value={lead.phone} label="Phone" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {(() => {
            const nationality = getLeadNationality(lead);
            const city = getLeadCity(lead);
            if (!nationality && !city) return null;
            return (
              <div className="flex items-center gap-1.5 pt-1">
                {nationality && (
                  <span className="text-[13px] text-muted-foreground">{displayCase(nationality)}</span>
                )}
                {nationality && city && (
                  <span className="text-[13px] text-muted-foreground">·</span>
                )}
                {city && (
                  <span className="text-[13px] text-muted-foreground">{displayCase(city)}</span>
                )}
              </div>
            );
          })()}
        </div>
        )}

        {/* Extra section (e.g. Study Interest) — flat, inside this card. The negative
            margin cancels the section's own header padding so its text lines up with
            the contact details above. Stays visible while editing: it follows the same
            page-level edit mode as the fields above. */}
        {detailsSlot && <div className="-mx-3 mt-3 mb-2">{detailsSlot}</div>}

        {/* Quick Actions, or Save/Cancel while editing — page-level actions
            (Edit/Convert/Delete) live in the Action dropdown below instead
            of a separate floating header, to reclaim that space. */}
        {isEditing ? (
          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
            <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={isSaving}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={isSaving || saveDisabled}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        ) : (
        <div className="flex items-center justify-between gap-1 pt-4 border-t border-border">
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
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Action</span>
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
              {(isItAgency || canDelete) && <DropdownMenuSeparator />}
              {isItAgency && (
                convertedContactId ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/contacts/${convertedContactId}`}>
                      <UserCheck className="h-4 w-4 mr-2" />
                      Converted to {convertedContactName ?? "Contact"}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={onConvertClick}>
                    <UserCheck className="h-4 w-4 mr-2" />
                    Convert to Contact
                  </DropdownMenuItem>
                )
              )}
              {canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deleting ? "Deleting..." : "Delete"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
