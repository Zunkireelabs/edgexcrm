"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OverviewTab } from "./overview-tab";
import { ProjectsTab } from "./projects-tab";
import { ContactsTab } from "./contacts-tab";
import type { Project, ProjectStatus } from "@/types/database";

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  status: string;
}

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}

interface AccountTabsProps {
  notes: string | null;
  contacts: AccountContact[];
  projects: Project[];
  leads: Lead[];
  projectStatusMix: Record<ProjectStatus, number>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
  onCreateProject: () => void;
  onCreateContact: () => void;
  onEditNotes: () => void;
}

export function AccountTabs({
  notes,
  contacts,
  projects,
  leads,
  projectStatusMix,
  activeTab,
  onTabChange,
  isAdmin,
  onCreateProject,
  onCreateContact,
  onEditNotes,
}: AccountTabsProps) {
  return (
    <TooltipProvider>
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <TabsTrigger value="activity" disabled>
                  Activity
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming soon — account activity feed v2</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <TabsTrigger value="billing" disabled>
                  Billing
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Coming soon — invoices, retainer, billable totals v2</TooltipContent>
          </Tooltip>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            notes={notes}
            contacts={contacts}
            leads={leads}
            projectStatusMix={projectStatusMix}
            onJumpToTab={onTabChange}
            onEditNotes={onEditNotes}
          />
        </TabsContent>

        <TabsContent value="projects" className="mt-0">
          <ProjectsTab
            projects={projects}
            isAdmin={isAdmin}
            onCreateProject={onCreateProject}
          />
        </TabsContent>

        <TabsContent value="contacts" className="mt-0">
          <ContactsTab
            contacts={contacts}
            isAdmin={isAdmin}
            onCreateContact={onCreateContact}
          />
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
