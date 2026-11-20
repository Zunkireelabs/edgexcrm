"use client";

import type { Lead } from "@/types/database";
import { useFee, type FeeApi, type UseFeeOptions } from "../application-tracking/hooks/use-fee";
import { useConsent, type ConsentApi } from "../application-tracking/hooks/use-consent";
import { useLeadApplications, type ApplicationsApi } from "../application-tracking/hooks/use-lead-applications";
import { useLeadEnrollments, type EnrollmentsApi } from "../classes/hooks/use-lead-enrollments";
import { useLeadDocuments, type DocumentsApi } from "../applicant-documents/use-lead-documents";
import { useLeadCheckIns, type CheckInsApi } from "@/industries/_shared/features/check-in/lead-check-in";
import { consentProfileKey } from "@/lib/consent/readiness";

/** The student file (EDGEX-154): ONE state per feature, read by the right rail, the matching tab and the stage card. */
export interface LeadFile {
  fee: FeeApi;
  consent: ConsentApi;
  applications: ApplicationsApi;
  enrollments: EnrollmentsApi;
  documents: DocumentsApi;
  checkIns: CheckInsApi;
}

export interface UseLeadFileParams {
  lead: Lead;
  /** The lead as the page first received it (the fee starts from these columns). */
  initialLead: Lead;
  tenantId: string;
  leadName: string;
  applicationsActive: boolean;
  consentEnabled: boolean;
  consentSigned: boolean;
  classesActive: boolean;
  documentsActive: boolean;
  checkInActive: boolean;
  /** processing fee: owner/admin records, others report */
  isAdmin: boolean;
  canManageApplications: boolean;
  onConsentSignedChange: (signed: boolean) => void;
  onFeeSaved: NonNullable<UseFeeOptions["onSaved"]>;
}

export function useLeadFile(p: UseLeadFileParams): LeadFile {
  const consentOn = p.applicationsActive && p.consentEnabled;
  const fee = useFee({
    leadId: p.lead.id,
    init: { status: p.initialLead.pre_app_fee_status, amount: p.initialLead.pre_app_fee_amount, notes: p.initialLead.pre_app_fee_notes },
    canManageFee: p.isAdmin, canManage: p.canManageApplications,
    onSaved: p.onFeeSaved,
  });
  const consent = useConsent({
    leadId: p.lead.id, tenantId: p.tenantId, profileKey: consentProfileKey(p.lead), enabled: consentOn, onSignedChange: p.onConsentSignedChange, allowCopyOnly: true,
  });
  const applications = useLeadApplications(p.lead.id, { enabled: p.applicationsActive, locked: p.consentEnabled && !p.consentSigned, leadName: p.leadName });
  const enrollments = useLeadEnrollments(p.lead.id, { enabled: p.classesActive, leadName: p.leadName });
  const documents = useLeadDocuments(p.lead.id, { enabled: p.documentsActive });
  const checkIns = useLeadCheckIns(p.lead.id, { enabled: p.checkInActive });
  return { fee, consent, applications, enrollments, documents, checkIns };
}
