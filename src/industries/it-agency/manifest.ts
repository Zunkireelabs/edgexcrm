import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { accountsMeta } from "./features/accounts/meta";
import { crmContactsMeta } from "./features/crm-contacts/meta";
import { timeTrackingMeta } from "./features/time-tracking/meta";
import { projectBoardMeta } from "./features/project-board/meta";
import { dealsMeta } from "./features/deals/meta";
import { servicesMeta } from "./features/services/meta";
import { aiConfig } from "./ai/agent";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.IT_AGENCY,
  features: [
    { meta: crmContactsMeta },
    { meta: accountsMeta },
    { meta: timeTrackingMeta },
    { meta: projectBoardMeta },
    { meta: dealsMeta },
    { meta: servicesMeta },
  ],
  sidebar: [
    {
      featureId: FEATURES.CRM_CONTACTS,
      href: "/contacts",
      label: "Contacts",
      icon: "Contact",
    },
    {
      featureId: FEATURES.ACCOUNTS,
      href: "/accounts",
      label: "Accounts",
      icon: "Building2",
    },
    {
      featureId: FEATURES.DEALS,
      href: "/deals",
      label: "Deals",
      icon: "Handshake",
    },
    {
      featureId: FEATURES.SERVICES,
      href: "/services",
      label: "Services",
      icon: "Package",
    },
    {
      kind: "group" as const,
      position: "after-pipeline" as const,
      id: "project-management",
      label: "Project Management",
      icon: "FolderKanban",
      children: [
        {
          featureId: FEATURES.PROJECT_BOARD,
          href: "/projects",
          label: "Projects",
          icon: "LayoutGrid",
        },
        {
          featureId: FEATURES.TIME_TRACKING,
          href: "/time-tracking",
          label: "Time Tracking",
          icon: "Clock",
        },
        {
          featureId: FEATURES.TIME_TRACKING,
          href: "/time-tracking/approvals",
          label: "Approvals",
          icon: "Stamp",
          minRoles: ["owner", "admin"] as const,
        },
      ],
    },
  ],
  ai: aiConfig,
};
