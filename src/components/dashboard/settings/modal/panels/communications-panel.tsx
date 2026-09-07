"use client";

import { Suspense } from "react";
import { PanelContent, PanelSection } from "../panel-shell";
import { EmailSenderCard } from "@/components/dashboard/settings/email-sender-card";
import { EmailBlastSettingsCard } from "@/components/dashboard/settings/email-blast-settings-card";
import { ChannelsCard } from "@/components/dashboard/settings/channels-card";
import { EmailRulesManager } from "@/components/dashboard/settings/email-rules-manager";
import { InboxConnector } from "@/industries/_shared/features/email/components/inbox-connector";
import { BccAddressPanel } from "@/industries/_shared/features/email/components/bcc-address-panel";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function CommunicationsPanel() {
  const { tenant, industryId, isSettingsAdmin } = useSettingsModal();
  const hasEmail = getFeatureAccess(industryId, FEATURES.EMAIL);
  const hasEmailCampaigns = getFeatureAccess(industryId, FEATURES.EMAIL_CAMPAIGNS);

  return (
    <PanelContent wide>
      <PanelSection>
        <EmailSenderCard />
      </PanelSection>
      {hasEmailCampaigns && (
        <PanelSection>
          <EmailBlastSettingsCard isAdmin={isSettingsAdmin} />
        </PanelSection>
      )}
      <PanelSection>
        <ChannelsCard />
      </PanelSection>
      <PanelSection>
        <EmailRulesManager tenantId={tenant.id} />
      </PanelSection>
      {hasEmail && (
        <PanelSection>
          <Suspense>
            <InboxConnector />
          </Suspense>
          <BccAddressPanel />
        </PanelSection>
      )}
    </PanelContent>
  );
}
