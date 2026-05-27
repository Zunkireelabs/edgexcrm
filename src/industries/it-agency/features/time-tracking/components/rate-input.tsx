"use client";

import { Input } from "@/components/ui/input";

interface RateInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function RateInput({
  id,
  value,
  onChange,
  placeholder = "0.00",
  disabled,
}: RateInputProps) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">
        $
      </span>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-7"
        disabled={disabled}
      />
    </div>
  );
}
