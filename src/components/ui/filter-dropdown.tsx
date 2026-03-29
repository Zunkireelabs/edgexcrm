"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  description?: string;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  icon?: React.ReactNode;
  searchable?: boolean;
}

export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  icon,
  searchable = true,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label || label;
  const isActive = value !== "all";

  // Filter options by search query
  const filteredOptions = options.filter((opt) => {
    const query = searchQuery.toLowerCase();
    return (
      opt.label.toLowerCase().includes(query) ||
      opt.description?.toLowerCase().includes(query)
    );
  });

  // Close dropdown on click outside
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

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, searchable]);

  // Handle escape key
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

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setIsOpen(false);
    setSearchQuery("");
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
              ? "border-[#2272B4] bg-blue-50 text-[#2272B4]"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
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
        <div
          className="absolute top-full left-0 mt-1.5 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Arrow pointer */}
          <div
            className="absolute -top-2 left-4 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45"
          />

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
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-[#2272B4] focus:border-transparent"
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
                const isSelected = value === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`
                      w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
                      ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}
                    `}
                  >
                    {/* Radio-style selection indicator */}
                    <div
                      className={`
                        mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                        ${isSelected ? "border-[#2272B4] bg-[#2272B4]" : "border-gray-300"}
                      `}
                    >
                      {isSelected && <Check className="w-2 h-2 text-white" />}
                    </div>

                    {/* Option content */}
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs font-medium ${
                          isSelected ? "text-[#2272B4]" : "text-gray-900"
                        }`}
                      >
                        {option.label}
                      </div>
                      {option.description && (
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                          {option.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
