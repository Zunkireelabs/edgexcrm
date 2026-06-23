"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { SettingsSidebar } from "./settings-sidebar";

// Lazy-load each panel for per-category code splitting
const GeneralPanel = dynamic(() => import("./panels/general-panel").then((m) => m.GeneralPanel));
const AiOrcaPanel = dynamic(() => import("./panels/ai-orca-panel").then((m) => m.AiOrcaPanel));
const OrganizationPanel = dynamic(() => import("./panels/organization-panel").then((m) => m.OrganizationPanel));
const TeamRolesPanel = dynamic(() => import("./panels/team-roles-panel").then((m) => m.TeamRolesPanel));
const LeadManagementPanel = dynamic(() => import("./panels/lead-management-panel").then((m) => m.LeadManagementPanel));
const AcademicOperationsPanel = dynamic(() => import("./panels/academic-operations-panel").then((m) => m.AcademicOperationsPanel));
const CommunicationsPanel = dynamic(() => import("./panels/communications-panel").then((m) => m.CommunicationsPanel));
const IntegrationsPanel = dynamic(() => import("./panels/integrations-panel").then((m) => m.IntegrationsPanel));
const CompliancePanel = dynamic(() => import("./panels/compliance-panel").then((m) => m.CompliancePanel));

const PANEL_MAP: Record<string, React.ComponentType> = {
  "general": GeneralPanel,
  "ai-orca": AiOrcaPanel,
  "organization": OrganizationPanel,
  "team-roles": TeamRolesPanel,
  "lead-management": LeadManagementPanel,
  "academic-operations": AcademicOperationsPanel,
  "communications": CommunicationsPanel,
  "integrations": IntegrationsPanel,
  "compliance": CompliancePanel,
};

function PanelSkeleton() {
  return (
    <div className="px-8 py-6 space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-gray-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}

export function SettingsModal({ isOpen, activeTab, onTabChange, onClose }: SettingsModalProps) {
  const ActivePanel = PANEL_MAP[activeTab] ?? GeneralPanel;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent
        className="w-[90vw] md:w-[80vw] max-w-[1440px] sm:max-w-[1440px] md:min-w-[720px] h-[85vh] p-0 flex gap-0 overflow-hidden"
        overlayClassName="bg-[#0000004d]"
        showCloseButton={false}
      >
        {/* Left sidebar */}
        <SettingsSidebar
          activeTab={activeTab}
          onTabChange={onTabChange}
        />

        {/* Right panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Panel content — fills remaining space */}
          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<PanelSkeleton />}>
              <ActivePanel />
            </Suspense>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
