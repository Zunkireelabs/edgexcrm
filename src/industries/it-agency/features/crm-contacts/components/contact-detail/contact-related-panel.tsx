"use client";

import { AccountCard } from "./account-card";
import { LinkedProjectsCard } from "./linked-projects-card";
import { RelatedContactsCard } from "./related-contacts-card";
import { LeadProvenanceCard } from "./lead-provenance-card";

type ProjectContactRole = "primary" | "technical" | "billing" | "other" | null;

interface ProjectLink {
  role: ProjectContactRole;
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts?: { id: string; name: string } | null;
  } | null;
}

interface AccountSibling {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

interface SourceLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface ContactRelatedPanelProps {
  account: { id: string; name: string } | null;
  accountOwnerEmail: string | null;
  projectLinks: ProjectLink[];
  accountSiblings: AccountSibling[];
  sourceLead: SourceLead | null;
  isAdmin: boolean;
  changingRoleFor: string | null;
  onAddToProject: () => void;
  onChangeRole: (projectId: string, role: ProjectContactRole) => void;
  onRemoveLink: (link: ProjectLink) => void;
}

export function ContactRelatedPanel({
  account,
  accountOwnerEmail,
  projectLinks,
  accountSiblings,
  sourceLead,
  isAdmin,
  changingRoleFor,
  onAddToProject,
  onChangeRole,
  onRemoveLink,
}: ContactRelatedPanelProps) {
  return (
    <div className="space-y-4">
      {account && (
        <AccountCard
          accountId={account.id}
          accountName={account.name}
          ownerEmail={accountOwnerEmail}
          projectCount={projectLinks.length}
          siblingCount={accountSiblings.length}
        />
      )}
      <LinkedProjectsCard
        projectLinks={projectLinks}
        isAdmin={isAdmin}
        changingRoleFor={changingRoleFor}
        onAddToProject={onAddToProject}
        onChangeRole={onChangeRole}
        onRemove={onRemoveLink}
      />
      <RelatedContactsCard
        siblings={accountSiblings}
        accountId={account?.id ?? null}
        accountName={account?.name ?? null}
      />
      <LeadProvenanceCard sourceLead={sourceLead} />
    </div>
  );
}
