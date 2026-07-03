"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Service } from "@/types/database";

interface ServiceFormProps {
  service?: Service;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (service: Service) => void;
}

const BILLING_TYPES: { value: Service["billing_type"]; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "hourly", label: "Hourly" },
  { value: "retainer", label: "Retainer" },
];

export function ServiceForm({ service, open, onOpenChange, onSuccess }: ServiceFormProps) {
  const isEdit = Boolean(service);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [billingType, setBillingType] = useState<Service["billing_type"]>(
    service?.billing_type ?? "fixed"
  );
  const [hours, setHours] = useState(service?.hours != null ? String(service.hours) : "");
  const [price, setPrice] = useState(service?.price != null ? String(service.price) : "");
  const [isActive, setIsActive] = useState(service?.is_active ?? true);

  function resetForm() {
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setCategory(service?.category ?? "");
    setBillingType(service?.billing_type ?? "fixed");
    setHours(service?.hours != null ? String(service.hours) : "");
    setPrice(service?.price != null ? String(service.price) : "");
    setIsActive(service?.is_active ?? true);
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    onOpenChange(next);
  }

  function isNonNegativeNumber(value: string): boolean {
    if (value.trim() === "") return true;
    const num = Number(value);
    return Number.isFinite(num) && num >= 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!isNonNegativeNumber(hours) || !isNonNegativeNumber(price)) {
      toast.error("Hours and price must be non-negative numbers");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/api/v1/services/${service!.id}` : "/api/v1/services";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          billing_type: billingType,
          hours: hours.trim() === "" ? null : Number(hours),
          price: price.trim() === "" ? null : Number(price),
          is_active: isActive,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save service");
      }
      const { data } = await res.json();
      toast.success(isEdit ? "Service updated" : "Service created");
      onSuccess(data as Service);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save service");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Service" : "New Service"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Name *</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website Redesign"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-description">Description</Label>
            <Textarea
              id="svc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of this package…"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-category">Category</Label>
            <Input
              id="svc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Design, Development, Marketing…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-billing-type">Billing type</Label>
            <Select value={billingType} onValueChange={(v) => setBillingType(v as Service["billing_type"])}>
              <SelectTrigger id="svc-billing-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_TYPES.map((bt) => (
                  <SelectItem key={bt.value} value={bt.value}>
                    {bt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-hours">Estimated hours</Label>
              <Input
                id="svc-hours"
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Price</Label>
              <Input
                id="svc-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="svc-active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            <Label htmlFor="svc-active" className="font-normal cursor-pointer">
              Active
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save changes" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
