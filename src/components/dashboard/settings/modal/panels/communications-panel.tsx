"use client";

import { Suspense } from "react";
import { PanelContent, PanelSection } from "../panel-shell";
import { EmailSenderCard } from "@/components/dashboard/settings/email-sender-card";
import { ChannelsCard } from "@/components/dashboard/settings/channels-card";
import { EmailRulesManager } from "@/components/dashboard/settings/email-rules-manager";
import { InboxConnector } from "@/industries/_shared/features/email/components/inbox-connector";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export function CommunicationsPanel() {
  const { tenant, industryId } = useSettingsModal();
  const hasEmail = getFeatureAccess(industryId, FEATURES.EMAIL);

  return (
    <PanelContent wide>
      <PanelSection>
        <EmailSenderCard />
      </PanelSection>
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
        </PanelSection>
      )}
    </PanelContent>
  );
}
