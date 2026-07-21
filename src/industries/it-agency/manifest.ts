import { FEATURES, INDUSTRIES } from "../_registry";
import type { IndustryManifest } from "../_types";
import { accountsMeta } from "./features/accounts/meta";
import { crmContactsMeta } from "./features/crm-contacts/meta";
import { timeTrackingMeta } from "./features/time-tracking/meta";
import { projectBoardMeta } from "./features/project-board/meta";
import { dealsMeta } from "./features/deals/meta";
import { servicesMeta } from "./features/services/meta";
import { proposalsMeta } from "./features/proposals/meta";
import { resourcingMeta } from "./features/resourcing/meta";
import { leadListsMeta } from "../_shared/features/lead-lists/meta";
import { insightsMeta } from "../_shared/features/insights/meta";
import { emailMeta } from "../_shared/features/email/meta";
import { outreachMeta } from "../_shared/features/outreach/meta";
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
    { meta: proposalsMeta },
    { meta: resourcingMeta },
    { meta: leadListsMeta },
    { meta: insightsMeta },
    { meta: emailMeta },
    { meta: outreachMeta },
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
      featureId: FEATURES.PROPOSALS,
      href: "/proposals",
      label: "Proposals",
      icon: "FileSignature",
    },
    {
      featureId: FEATURES.OUTREACH,
      href: "/outreach",
      label: "Outreach",
      icon: "Send",
    },
    {
      featureId: FEATURES.RESOURCING,
      href: "/resourcing",
      label: "Resourcing",
      icon: "Users",
    },
    {
      featureId: FEATURES.RESOURCING,
      href: "/resourcing/utilization",
      label: "Utilization",
      icon: "Gauge",
    },
    {
      position: "after-pipeline" as const,
      featureId: FEATURES.PROJECT_BOARD,
      href: "/projects",
      label: "Projects",
      icon: "LayoutGrid",
    },
    {
      position: "after-pipeline" as const,
      featureId: FEATURES.PROJECT_BOARD,
      href: "/tasks",
      label: "Tasks",
      icon: "ListTodo",
    },
    {
      position: "after-pipeline" as const,
      featureId: FEATURES.TIME_TRACKING,
      href: "/time-tracking",
      label: "Time Tracking",
      icon: "Clock",
    },
    {
      position: "after-pipeline" as const,
      featureId: FEATURES.PROJECT_BOARD,
      href: "/approvals",
      label: "Approvals",
      icon: "Stamp",
      minRoles: ["owner", "admin"] as const,
    },
  ],
  ai: aiConfig,
};
