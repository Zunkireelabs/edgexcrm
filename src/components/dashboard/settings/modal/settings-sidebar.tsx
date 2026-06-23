"use client";

import { useSettingsModal } from "@/contexts/settings-modal-context";
import { SETTINGS_CATEGORIES } from "./settings-registry";
import { cn } from "@/lib/utils";

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const { tenant, role, industryId, isEducation } = useSettingsModal();
  const ctx = { role, industryId, isEducation };

  const visibleCategories = SETTINGS_CATEGORIES.filter((c) => c.isVisible(ctx));

  return (
    <div className="w-60 flex-shrink-0 border-r border-[#e5e7eb] flex flex-col bg-[#fafafa]">
      {/* Org identity block */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
          >
            {tenant.name?.charAt(0) ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{tenant.name}</p>
            <p className="text-xs text-gray-400 capitalize">{role}</p>
          </div>
        </div>
      </div>

      {/* Category list */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleCategories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeTab === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => onTabChange(cat.key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
                isActive
                  ? "bg-[#ebebeb] text-gray-900 font-medium"
                  : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900",
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{cat.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
