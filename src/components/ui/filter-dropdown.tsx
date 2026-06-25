"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  description?: string;
}

type FilterDropdownProps =
  | {
      label: string;
      multiple?: false;
      value: string;
      onChange: (value: string) => void;
      options: FilterOption[];
      icon?: React.ReactNode;
      searchable?: boolean;
    }
  | {
      label: string;
      multiple: true;
      value: string[];
      onChange: (next: string[]) => void;
      options: FilterOption[];
      icon?: React.ReactNode;
      searchable?: boolean;
    };

export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  icon,
  searchable = true,
  ...rest
}: FilterDropdownProps) {
  const multiple = (rest as { multiple?: boolean }).multiple === true;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Derived display label and active state
  let displayLabel: string;
  let isActive: boolean;
  if (multiple) {
    const selected = value as string[];
    if (selected.length === 0) {
      displayLabel = label;
    } else if (selected.length === 1) {
      const opt = options.find((o) => o.value === selected[0]);
      displayLabel = `${label}: ${opt?.label ?? selected[0]}`;
    } else {
      displayLabel = `${label} (${selected.length})`;
    }
    isActive = selected.length > 0;
  } else {
    const single = value as string;
    const selectedOption = options.find((opt) => opt.value === single);
    displayLabel = selectedOption?.label || label;
    isActive = single !== "all" && single !== "__all__";
  }

  const filteredOptions = options.filter((opt) => {
    const query = searchQuery.toLowerCase();
    return (
      opt.label.toLowerCase().includes(query) ||
      opt.description?.toLowerCase().includes(query)
    );
  });

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, searchable]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function handleSelectSingle(optionValue: string) {
    (onChange as (v: string) => void)(optionValue);
    setIsOpen(false);
    setSearchQuery("");
  }

  function handleSelectMulti(optionValue: string) {
    const current = value as string[];
    const next = current.includes(optionValue)
      ? current.filter((v) => v !== optionValue)
      : [...current, optionValue];
    (onChange as (v: string[]) => void)(next);
    // keep dropdown open; don't clear search
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium
          rounded-md border transition-colors
          ${
            isActive
              ? "border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]"
              : "border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
          }
        `}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate max-w-[120px]">{displayLabel}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Arrow pointer */}
          <div className="absolute -top-2 left-4 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45" />

          {/* Search input */}
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-transparent"
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 text-center">
                No results found
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = multiple
                  ? (value as string[]).includes(option.value)
                  : (value as string) === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      multiple
                        ? handleSelectMulti(option.value)
                        : handleSelectSingle(option.value)
                    }
                    className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#0000170b]"
                  >
                    {/* Selection indicator — square checkbox for multi-select, circle radio for single-select */}
                    {multiple ? (
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-[4px] border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-[#0f0f10] bg-[#0f0f10]" : "border-gray-400"
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    ) : (
                      <div
                        className={`
                          mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                          ${isSelected ? "border-[#0f0f10] bg-[#0f0f10]" : "border-gray-300"}
                        `}
                      >
                        {isSelected && <Check className="w-2 h-2 text-white" />}
                      </div>
                    )}

                    {/* Option content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[#0f0f10]">
                        {option.label}
                      </div>
                      {option.description && (
                        <div className="text-[11px] text-[#787871] mt-0.5 truncate">
                          {option.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Clear button for multi-select when selections exist */}
          {multiple && (value as string[]).length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => (onChange as (v: string[]) => void)([])}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
