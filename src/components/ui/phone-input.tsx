"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const selectedCountry = findCountryValue(parsed.dialCode || DEFAULT_DIAL_CODE);
  const localNumber = parsed.localNumber;
  const currentDialCode = codeMap[selectedCountry] || DEFAULT_DIAL_CODE;

  const handleCountryChange = (countryValue: string) => {
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
      <Select value={selectedCountry} onValueChange={handleCountryChange} disabled={disabled}>
        <SelectTrigger
          className={`h-9 w-[90px] rounded-r-none border-r-0 shrink-0 ${error ? "border-red-500" : ""}`}
        >
          <SelectValue>
            {currentDialCode}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {COUNTRY_CODES.map((cc) => (
            <SelectItem key={cc.value} value={cc.value}>
              {cc.dialCode} {cc.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
