"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { COUNTRY_CODES, DEFAULT_DIAL_CODE } from "@/lib/country-codes";
import { parseStoredPhone, formatPhoneForStorage } from "@/lib/phone-utils";

interface PhoneInputProps {
  value: string;
  onChange: (fullPhone: string) => void;
  disabled?: boolean;
  className?: string;
  error?: boolean;
  placeholder?: string;
  size?: "default" | "sm";
}

const codeMap: Record<string, string> = {};
for (const cc of COUNTRY_CODES) {
  codeMap[cc.value] = cc.dialCode;
}

function findCountryValue(dialCode: string): string {
  const found = COUNTRY_CODES.find((cc) => cc.dialCode === dialCode);
  return found?.value || "nepal";
}

export function PhoneInput({
  value,
  onChange,
  disabled = false,
  className,
  error = false,
  placeholder = "Phone number",
}: PhoneInputProps) {
  const parsed = useMemo(() => parseStoredPhone(value || ""), [value]);
  const localNumber = parsed.localNumber;
  const derivedCountry = findCountryValue(parsed.dialCode || DEFAULT_DIAL_CODE);
  // Picking a country while the number is still blank has nothing to write into
  // `value` yet — formatPhoneForStorage() can't encode "dial code, no digits" —
  // so without this the choice is silently dropped on the next render. Track it
  // locally until there's a number to attach it to. Every consumer mounts this
  // behind a form/sheet that unmounts on close, so this resets naturally rather
  // than needing to be watched for `value` going back to empty.
  const [countryOverride, setCountryOverride] = useState<string | null>(null);
  const selectedCountry = localNumber ? derivedCountry : (countryOverride ?? derivedCountry);
  const currentDialCode = codeMap[selectedCountry] || DEFAULT_DIAL_CODE;

  const handleCountryChange = (countryValue: string) => {
    setCountryOverride(countryValue);
    const newDialCode = codeMap[countryValue] || DEFAULT_DIAL_CODE;
    if (localNumber) {
      onChange(formatPhoneForStorage(newDialCode, localNumber));
    }
  };

  const handleNumberChange = (num: string) => {
    if (num) {
      onChange(formatPhoneForStorage(currentDialCode, num));
    } else {
      onChange("");
    }
  };

  return (
    <div className={`flex ${className || ""}`}>
      {/* EDGEX-145: searchable country picker (same values as before; the trigger still shows only the dial code) */}
      <SearchableSelect
        value={selectedCountry}
        onValueChange={handleCountryChange}
        options={COUNTRY_CODES.map((cc) => ({ value: cc.value, label: `${cc.dialCode} ${cc.label}` }))}
        summarize={() => currentDialCode}
        searchPlaceholder="Search countries…"
        aria-label="Country code"
        aria-invalid={error || undefined}
        disabled={disabled}
        className={`h-9 w-[90px] rounded-r-none border-r-0 shrink-0 ${error ? "border-red-500" : ""}`}
      />
      <Input
        type="tel"
        value={localNumber}
        onChange={(e) => handleNumberChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`h-9 rounded-l-none ${error ? "border-red-500" : ""}`}
      />
    </div>
  );
}
