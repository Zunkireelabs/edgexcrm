"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OverviewTab } from "./overview-tab";
import { ProjectsTab } from "./projects-tab";
import { ContactsTab } from "./contacts-tab";
import { ActivityTab } from "./activity-tab";
import { BillingTab } from "./billing-tab";
import type { ActivityItem } from "./activity-row";
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

interface ActivityData {
  items: ActivityItem[];
  next_page: number | null;
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
  accountId: string;
  initialActivity?: ActivityData | null;
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
  accountId,
  initialActivity,
}: AccountTabsProps) {
  return (
    <TooltipProvider>
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
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

        <TabsContent value="activity" className="mt-0">
          <ActivityTab accountId={accountId} initialData={initialActivity ?? null} />
        </TabsContent>

        <TabsContent value="billing" className="mt-0">
          <BillingTab accountId={accountId} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
