"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, FormConfig, FormStep, FormField } from "@/types/database";
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
import { CheckCircle, Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

interface PublicFormProps {
  tenant: Tenant;
  formConfig: FormConfig;
}

export function PublicForm({ tenant, formConfig }: PublicFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, string | boolean | number>>({});
  const [fileData, setFileData] = useState<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [sessionId] = useState(
    () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );

  // Read URL query params client-side (keeps page statically generated)
  const [bg] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return new URLSearchParams(window.location.search).get("bg") ?? undefined;
  });
  const [compact] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("compact") === "1";
  });

  // Auto-select the first option for country fields linked to a phone field,
  // so the displayed dial code matches the actual form state.
  useEffect(() => {
    for (const step of steps) {
      for (const field of step.fields) {
        if (field.type === "tel" && field.country_field) {
          const countryField = step.fields.find(
            (f) => f.name === field.country_field
          );
          if (countryField?.options?.length && !formData[countryField.name]) {
            setFormData((d) => {
              if (d[countryField.name]) return d;
              return { ...d, [countryField.name]: countryField.options![0].value };
            });
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps: FormStep[] = formConfig.steps || [];
  const branding = formConfig.branding || {};
  const primaryColor = branding.primary_color || tenant.primary_color;
  const hideLabels = branding.hide_labels === true;
  const buttonText = branding.button_text || "Submit Application";

  const isLastStep = currentStep === steps.length - 1;
  const fieldBg = hideLabels ? "bg-[#F9FAFB]" : "bg-white";
  const compactInput = hideLabels
    ? compact
      ? `!h-9 rounded-[10px] text-[13px] px-3 py-1 ${fieldBg}`
      : `!h-11 rounded-[10px] text-[15px] px-4 py-2 ${fieldBg}`
    : "bg-white";
  const compactSelect = hideLabels
    ? compact
      ? `!h-9 rounded-[10px] text-[13px] px-3 ${fieldBg}`
      : `!h-11 rounded-[10px] text-[15px] px-4 ${fieldBg}`
    : "bg-white";

  // Check field visibility based on conditional logic
  const isFieldVisible = useCallback(
    (field: FormField) => {
      if (!field.conditional) return true;
      const depValue = formData[field.conditional.field];
      return field.conditional.values.includes(String(depValue));
    },
    [formData]
  );

  function validateStep(): boolean {
    const step = steps[currentStep];
    if (!step) return true;
    const newErrors: Record<string, string> = {};

    for (const field of step.fields) {
      if (!isFieldVisible(field)) continue;

      const value = formData[field.name];

      if (field.type === "file") {
        if (field.required && !fileData[field.name]) {
          newErrors[field.name] = `${field.label} is required`;
        }
        continue;
      }

      if (field.type === "checkbox") {
        if (field.required && !value) {
          newErrors[field.name] = `${field.label} is required`;
        }
        continue;
      }

      if (field.type === "number") {
        if (field.required && (value === undefined || value === "")) {
          newErrors[field.name] = `${field.label} is required`;
        } else if (value !== undefined && value !== "") {
          const num = Number(value);
          if (isNaN(num)) {
            newErrors[field.name] = "Must be a valid number";
          } else if (field.validation?.min !== undefined && num < field.validation.min) {
            newErrors[field.name] = `Minimum value is ${field.validation.min}`;
          } else if (field.validation?.max !== undefined && num > field.validation.max) {
            newErrors[field.name] = `Maximum value is ${field.validation.max}`;
          }
        }
        continue;
      }

      if (field.type === "date") {
        const strVal = String(value || "").trim();
        if (field.required && !strVal) {
          newErrors[field.name] = `${field.label} is required`;
        } else if (strVal) {
          if (field.validation?.min_date && strVal < field.validation.min_date) {
            newErrors[field.name] = `Date must be on or after ${field.validation.min_date}`;
          } else if (field.validation?.max_date && strVal > field.validation.max_date) {
            newErrors[field.name] = `Date must be on or before ${field.validation.max_date}`;
          }
        }
        continue;
      }

      // text, email, tel, select, textarea, radio
      if (!field.required) continue;
      const val = String(value || "").trim();
      if (!val) {
        newErrors[field.name] = `${field.label} is required`;
      }
      if (field.type === "email" && val) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          newErrors[field.name] = "Invalid email address";
        }
      }
      if (field.validation?.pattern && val) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(val)) {
          newErrors[field.name] = `Invalid ${field.label.toLowerCase()}`;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function savePartial() {
    const payload: Record<string, unknown> = {
      tenant_id: tenant.id,
      session_id: sessionId,
      step: currentStep + 1,
      is_final: false,
      status: "partial",
      first_name: (formData.first_name as string) || null,
      last_name: (formData.last_name as string) || null,
      email: (formData.email as string) || null,
      phone: (formData.phone as string) || null,
      city: (formData.city as string) || null,
      country: (formData.country as string) || null,
      custom_fields: Object.fromEntries(
        Object.entries(formData).filter(
          ([k]) =>
            !["first_name", "last_name", "email", "phone", "city", "country"].includes(k)
        )
      ),
      form_config_id: formConfig.id,
      idempotency_key: `${sessionId}-step-${currentStep + 1}`,
      ...(leadId && { lead_id: leadId }),
    };

    try {
      const res = await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.data?.id && !leadId) {
          setLeadId(result.data.id);
        }
      }
    } catch {
      // Partial save failure is non-blocking
    }
  }

  async function handleNext() {
    if (!validateStep()) return;
    await savePartial();
    setCurrentStep((s) => s + 1);
  }

  async function handleSubmit() {
    if (!validateStep()) return;
    setSubmitting(true);

    try {
      const supabase = createClient();

      // Upload files via signed URLs
      const fileUrls: Record<string, string> = {};
      for (const [key, file] of Object.entries(fileData)) {
        // Get signed upload URL from API
        const uploadRes = await fetch("/api/v1/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenant.id,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            field_name: key,
            session_id: sessionId,
          }),
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          toast.error(
            err?.error?.details?.file_size?.[0] ||
            err?.error?.details?.mime_type?.[0] ||
            err?.error?.message ||
            "File upload failed"
          );
          setSubmitting(false);
          return;
        }

        const { data: signedData } = await uploadRes.json();

        // Upload file using signed URL via Supabase client
        const { error: uploadError } = await supabase.storage
          .from("lead-documents")
          .uploadToSignedUrl(signedData.path, signedData.token, file);

        if (uploadError) {
          toast.error(`Failed to upload ${key}`);
          setSubmitting(false);
          return;
        }

        fileUrls[key] = signedData.public_url;
      }

      // Final save via API
      const payload: Record<string, unknown> = {
        tenant_id: tenant.id,
        session_id: sessionId,
        step: steps.length,
        is_final: true,
        status: "new",
        first_name: formData.first_name || null,
        last_name: formData.last_name || null,
        email: formData.email || null,
        phone: formData.phone || null,
        city: formData.city || null,
        country: formData.country || null,
        custom_fields: Object.fromEntries(
          Object.entries(formData).filter(
            ([k]) =>
              !["first_name", "last_name", "email", "phone", "city", "country"].includes(k)
          )
        ),
        file_urls: fileUrls,
        form_config_id: formConfig.id,
        idempotency_key: `${sessionId}-final`,
        ...(leadId && { lead_id: leadId }),
      };

      const res = await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        toast.error("Failed to submit application");
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setSubmitted(true);

      // Redirect after delay
      if (formConfig.redirect_url) {
        setTimeout(() => {
          window.location.href = formConfig.redirect_url!;
        }, 3000);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const bgColor = bg ? (bg.startsWith("#") ? bg : `#${bg}`) : null;
  const bgGradient = bgColor ? `linear-gradient(to bottom, ${bgColor}, #FFFFFF)` : null;

  // Warn before unload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(formData).length > 0 && !submitted) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formData, submitted]);

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        {bgGradient && <style>{`html, body { background: ${bgGradient} !important; min-height: 100%; }`}</style>}
        <div className="max-w-md w-full text-center p-8">
          <CheckCircle
            className="h-16 w-16 mx-auto mb-4"
            style={{ color: primaryColor }}
          />
          <h2 className="text-2xl font-bold mb-2">
            {branding.thank_you_title || "Thank You!"}
          </h2>
          <p className="text-muted-foreground">
            {branding.thank_you_message ||
              "Your application has been submitted successfully. We will get back to you soon."}
          </p>
          {formConfig.redirect_url && (
            <p className="text-sm text-muted-foreground mt-4">
              Redirecting in a few seconds...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {bgGradient && <style>{`html, body { background: ${bgGradient} !important; min-height: 100%; }`}</style>}
        <p className="text-muted-foreground">This form is not configured yet.</p>
      </div>
    );
  }

  const step = steps[currentStep];

  return (
    <div className="flex items-start justify-center">
      {bgGradient && <style>{`html, body { background: ${bgGradient} !important; min-height: 100%; }`}</style>}
      <div className={`w-full ${hideLabels ? (compact ? "p-3" : "p-5") : ""}`}>
        {/* Logo only */}
        {branding.logo_url && (
          <div className="text-center mb-6">
            <img
              src={branding.logo_url}
              alt={tenant.name}
              className="h-12 mx-auto"
            />
          </div>
        )}

        {/* Step indicator */}
        {steps.length > 1 && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    i <= currentStep
                      ? "text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                  style={
                    i <= currentStep
                      ? { backgroundColor: primaryColor }
                      : undefined
                  }
                >
                  {i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`h-0.5 w-8 ${
                      i < currentStep ? "" : "bg-gray-200"
                    }`}
                    style={
                      i < currentStep
                        ? { backgroundColor: primaryColor }
                        : undefined
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Form card */}
        <div>
          {!hideLabels && step.title && (
            <h2 className="text-lg font-semibold mb-4">{step.title}</h2>
          )}

          <div className={`flex flex-wrap ${hideLabels ? (compact ? "gap-3" : "gap-5") : "gap-4"}`}>
            {step.fields.map((field) => {
              if (!isFieldVisible(field)) return null;

              const gap = hideLabels ? "0.625rem" : "0.5rem";
              const widthMap: Record<string, string> = {
                half: `calc(50% - ${gap})`,
                third: `calc(33.33% - ${gap} * 1.33)`,
                "two-thirds": `calc(66.67% - ${gap} * 0.67)`,
              };
              const fieldWidth = widthMap[field.width || ""] || "100%";

              return (
                <div
                  key={field.name}
                  className={hideLabels ? "" : "space-y-1.5"}
                  style={{ width: fieldWidth }}
                >
                  {!hideLabels && (
                    <Label htmlFor={field.name}>
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                  )}

                  {field.type === "select" && (
                    <Select
                      value={String(formData[field.name] || "")}
                      onValueChange={(val) =>
                        setFormData((d) => ({ ...d, [field.name]: val }))
                      }
                    >
                      <SelectTrigger className={`w-full ${compactSelect}`} style={hideLabels ? { height: compact ? 36 : 44 } : undefined}>
                        <SelectValue
                          placeholder={field.placeholder || "Select..."}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.type === "textarea" && (
                    <Textarea
                      id={field.name}
                      placeholder={field.placeholder}
                      value={String(formData[field.name] || "")}
                      className={fieldBg}
                      onChange={(e) =>
                        setFormData((d) => ({
                          ...d,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  )}

                  {field.type === "file" && (
                    <Input
                      id={field.name}
                      type="file"
                      className={fieldBg}
                      accept={
                        field.validation?.accepted_types?.join(",") ||
                        ".pdf,.jpg,.jpeg,.png"
                      }
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const maxMb =
                            field.validation?.max_size_mb || 100;
                          if (file.size > maxMb * 1024 * 1024) {
                            setErrors((errs) => ({
                              ...errs,
                              [field.name]: `File too large (max ${maxMb}MB)`,
                            }));
                            return;
                          }
                          setFileData((d) => ({ ...d, [field.name]: file }));
                          setErrors((errs) => {
                            const next = { ...errs };
                            delete next[field.name];
                            return next;
                          });
                        }
                      }}
                    />
                  )}

                  {(field.type === "text" ||
                    field.type === "email") && (
                    <Input
                      id={field.name}
                      type={field.type}
                      placeholder={field.placeholder}
                      className={compactInput}
                      style={hideLabels ? { height: compact ? 36 : 44 } : undefined}
                      value={String(formData[field.name] || "")}
                      onChange={(e) =>
                        setFormData((d) => ({
                          ...d,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  )}

                  {field.type === "tel" && (() => {
                    let dialCode = "";
                    if (field.country_field) {
                      const countryValue = formData[field.country_field];
                      const countryField = step.fields.find(
                        (f) => f.name === field.country_field
                      );
                      const selectedOption = countryValue
                        ? countryField?.options?.find((o) => o.value === countryValue)
                        : countryField?.options?.[0];
                      dialCode = selectedOption?.dial_code || "";
                    }
                    return (
                      <div className="flex" style={hideLabels ? { height: compact ? 36 : 44 } : undefined}>
                        {dialCode && (
                          <span
                            className={`inline-flex items-center border border-r-0 text-muted-foreground whitespace-nowrap ${hideLabels ? `rounded-l-[10px] ${fieldBg}` : "rounded-l-md bg-white"} ${compact ? "px-3 text-[13px]" : "px-4 text-sm"}`}
                            style={hideLabels ? { height: compact ? 36 : 44 } : undefined}
                          >
                            {dialCode}
                          </span>
                        )}
                        <Input
                          id={field.name}
                          type="tel"
                          placeholder={field.placeholder}
                          value={String(formData[field.name] || "")}
                          className={`${compactInput} ${dialCode ? (hideLabels ? "rounded-l-none rounded-r-[10px]" : "rounded-l-none") : ""}`}
                          style={hideLabels ? { height: compact ? 36 : 44 } : undefined}
                          onChange={(e) =>
                            setFormData((d) => ({
                              ...d,
                              [field.name]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    );
                  })()}

                  {field.type === "checkbox" && (
                    <div className="flex items-center gap-2">
                      <input
                        id={field.name}
                        type="checkbox"
                        checked={!!formData[field.name]}
                        onChange={(e) =>
                          setFormData((d) => ({
                            ...d,
                            [field.name]: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {field.placeholder && (
                        <span className="text-sm text-muted-foreground">
                          {field.placeholder.includes("terms & conditions") ? (
                            <>
                              {field.placeholder.split("terms & conditions")[0]}
                              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                                terms &amp; conditions
                              </a>
                              {field.placeholder.split("terms & conditions")[1]}
                            </>
                          ) : (
                            field.placeholder
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {field.type === "radio" && field.options && (
                    <div className="space-y-2">
                      {field.options.map((opt) => (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={field.name}
                            value={opt.value}
                            checked={formData[field.name] === opt.value}
                            onChange={(e) =>
                              setFormData((d) => ({
                                ...d,
                                [field.name]: e.target.value,
                              }))
                            }
                            className="h-4 w-4 border-gray-300"
                          />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {field.type === "date" && (
                    <Input
                      id={field.name}
                      type="date"
                      className={compactInput}
                      style={hideLabels ? { height: compact ? 36 : 44 } : undefined}
                      value={String(formData[field.name] || "")}
                      min={field.validation?.min_date}
                      max={field.validation?.max_date}
                      onChange={(e) =>
                        setFormData((d) => ({
                          ...d,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  )}

                  {field.type === "number" && (
                    <Input
                      id={field.name}
                      type="number"
                      className={compactInput}
                      style={hideLabels ? { height: compact ? 36 : 44 } : undefined}
                      placeholder={field.placeholder}
                      value={String(formData[field.name] ?? "")}
                      min={field.validation?.min}
                      max={field.validation?.max}
                      onChange={(e) =>
                        setFormData((d) => ({
                          ...d,
                          [field.name]: e.target.value === "" ? "" : Number(e.target.value),
                        }))
                      }
                    />
                  )}

                  {errors[field.name] && (
                    <p className="text-xs text-red-500">{errors[field.name]}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Navigation buttons */}
          <div className={`flex ${compact ? "mt-3" : "mt-6"} ${hideLabels ? "flex-col" : "justify-center"}`}>
            {currentStep > 0 ? (
              <Button
                variant="outline"
                onClick={() => setCurrentStep((s) => s - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            ) : (
              <div />
            )}

            {isLastStep ? (
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className={hideLabels ? "w-full text-base py-6" : ""}
                style={{ backgroundColor: primaryColor }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  buttonText
                )}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                style={{ backgroundColor: primaryColor }}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
