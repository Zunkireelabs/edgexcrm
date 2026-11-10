# EDGEX-145 Dialogs v1 inventory

Every `DialogContent` / `AlertDialogContent` consumer after the shared-shell restyle (generated from the source on 2026-11-11).
`Status` is filled in by the live sweep (see the sweep table in the report): OK = opened live and looks right, `static` = checked by reading
the class list only (needs a state that local seed data cannot produce).

| File | Kind | Content blocks | Dialog title(s) | className on content |
|---|---|---|---|---|
| `src/components/dashboard/add-link-dialog.tsx` | Dialog | 1 | Add a Link | `sm:max-w-[425px]` |
| `src/components/dashboard/add-note-dialog.tsx` | Dialog | 1 | Add a Note | `sm:max-w-[500px]` |
| `src/components/dashboard/api-keys-manager.tsx` | Dialog | 1 | Create API Key;   | `` |
| `src/components/dashboard/blocking-notice.tsx` | Alert | 1 | `notice?.title` | `sm:max-w-xl` |
| `src/components/dashboard/create-knowledge-base-modal.tsx` | Dialog | 1 | New Knowledge Base | `sm:max-w-[425px]` |
| `src/components/dashboard/hr/attendance/regularize-dialog.tsx` | Dialog | 1 | Regularize Attendance | `max-w-sm` |
| `src/components/dashboard/hr/leave/team-leave-panel.tsx` | Dialog | 1 | Reject Leave Request | `max-w-sm` |
| `src/components/dashboard/knowledge-base-card.tsx` | Dialog | 2 | Rename Knowledge Base; Delete Knowledge Base | `sm:max-w-[425px] / sm:max-w-[400px]` |
| `src/components/dashboard/knowledge-base-items-table.tsx` | Dialog | 1 | Edit Item | `sm:max-w-[500px]` |
| `src/components/dashboard/lead/activities/log-activity-modal.tsx` | Dialog | 1 | `getTitle()` | `sm:max-w-[425px]` |
| `src/components/dashboard/lead/branches-block.tsx` | Dialog | 1 | Send to branch | `` |
| `src/components/dashboard/lead/key-info-section.tsx` | Dialog | 1 | Change status to{" "}
              {pipelineStages.find((s) => s.id === pendingStageId)?. | `max-w-md sm:max-w-md` |
| `src/components/dashboard/lead/lead-detail-v2.tsx` | Dialog | 1 | Qualify Lead | `max-w-md` |
| `src/components/dashboard/lead/merge-dialog.tsx` | Dialog | 1 | Merge duplicate leads | `max-w-2xl` |
| `src/components/dashboard/leads-table.tsx` | Dialog | 5 | Delete {selectedCount} lead{selectedCount !== 1 ? "s" : ""}?; Assign {selectedCount} lead{ | `` |
| `src/components/dashboard/leads/applications-gate-dialog.tsx` | Dialog | 1 |   | `max-w-md` |
| `src/components/dashboard/leads/column-manager-dialog.tsx` | Dialog | 1 | Choose which columns you see | `max-w-2xl p-0 gap-0` |
| `src/components/dashboard/leads/list-stepper.tsx` | Dialog | 1 |  {confirmList
                ? isNextDirection
                  ? moveConfirmMessage(con | `max-w-md sm:max-w-md` |
| `src/components/dashboard/leads/move-to-list-selector.tsx` | Dialog | 1 |  {confirmList ? moveConfirmMessage(confirmList) : ""}; `confirmList ? moveConfirmMessage(c | `max-w-md sm:max-w-md` |
| `src/components/dashboard/leads/prospect-qualification-dialog.tsx` | Dialog | 1 | Add academic qualification | `max-w-lg` |
| `src/components/dashboard/leads/qualify-row-button.tsx` | Dialog | 1 | Qualify Lead | `max-w-md` |
| `src/components/dashboard/leads/stage-move-selector.tsx` | Dialog | 1 |  {confirmList ? moveConfirmMessage(confirmList) : ""}; `confirmList ? moveConfirmMessage(c | `max-w-md sm:max-w-md` |
| `src/components/dashboard/orca/agents-content.tsx` | Dialog | 1 | Add Agent | `max-w-sm` |
| `src/components/dashboard/orca/configure-agent-dialog.tsx` | Dialog | 1 | Configure automation | `max-w-lg` |
| `src/components/dashboard/settings/agents-manager.tsx` | Dialog | 1 |  {editingAgent ? `Edit "${editingAgent.name}"` : "New Agent"}; `editingAgent ? `Edit "${ed | `max-w-sm` |
| `src/components/dashboard/settings/channels-card.tsx` | Dialog | 4 | Connect WhatsApp; WhatsApp connected ✓; Update token for {tokenTarget?.display_name}; Disc | `` |
| `src/components/dashboard/settings/classes-manager.tsx` | Dialog | 1 |  {editingClass ? `Edit "${editingClass.name}"` : "New Class"}; `editingClass ? `Edit "${ed | `max-w-sm` |
| `src/components/dashboard/settings/email-rules-manager.tsx` | Dialog | 2 |  {editingRule ? "Edit Email Rule" : "Add Email Rule"}; Delete Email Rule; `editingRule ? " | `sm:max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col / sm:max-w-[400px]` |
| `src/components/dashboard/settings/industry-entities-manager.tsx` | Dialog | 1 |  {editEntity ? "Edit" : "Add"} {industry.entity_type_singular}; `editEntity ? "Edit" : "Ad | `` |
| `src/components/dashboard/settings/lead-lists-manager.tsx` | Dialog | 1 |  {editingList ? `Edit "${editingList.name}"` : "New List"}; `editingList ? `Edit "${editin | `max-w-md max-h-[90vh] overflow-y-auto` |
| `src/components/dashboard/settings/lookup-table-manager.tsx` | Dialog | 1 |  {editingItem ? `Edit "${editingItem.name}"` : `Add ${itemLabel}`}; `editingItem ? `Edit " | `max-w-sm` |
| `src/components/dashboard/settings/modal/settings-modal.tsx` | Dialog | 1 |  | `w-[90vw] md:w-[80vw] max-w-[1440px] sm:max-w-[1440px] md:min-w-[720px] h-[85vh] p-0 flex g` |
| `src/components/dashboard/settings/partner-colleges-manager.tsx` | Dialog | 1 |  {editingCollege ? `Edit "${editingCollege.name}"` : "Add College"}; `editingCollege ? `Ed | `max-w-sm` |
| `src/components/dashboard/settings/positions-manager.tsx` | Dialog | 1 |  {editingPosition ? `Edit "${editingPosition.name}"` : "New Role"}; `editingPosition ? `Ed | `max-w-lg max-h-[90vh] overflow-y-auto` |
| `src/components/dashboard/settings/programs-manager.tsx` | Dialog | 1 |  {editingProgram ? `Edit "${editingProgram.name}"` : "Add Program"}; `editingProgram ? `Ed | `max-w-sm` |
| `src/components/dashboard/tasks/task-detail.tsx` | Alert | 1 | Delete this task? | `` |
| `src/components/pipeline/CreatePipelineModal.tsx` | Dialog | 1 | Create New Pipeline | `sm:max-w-[425px]` |
| `src/components/pipeline/MoveToPipelineModal.tsx` | Dialog | 1 | Move to Pipeline | `sm:max-w-[420px]` |
| `src/components/pipeline/PipelineSettingsModal.tsx` | Dialog | 2 | Delete {stageWord}; `listStageMode ? `Manage ${stageWord` | `sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col / sm:max-w-[400px]` |
| `src/components/pipeline/StageEditor.tsx` | Dialog | 1 |  {mode === "add" ? `Add ${stageWord}` : `Edit ${stageWord}`}; `mode === "add" ? `Add ${sta | `sm:max-w-[400px]` |
| `src/components/ui/command.tsx` | Dialog | 1 | `title` | `overflow-hidden p-0 shadow-lg` |
| `src/industries/_shared/features/email-campaigns/ui/blast-content-preview-dialog.tsx` | Dialog | 1 | Email content | `flex h-[85vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl` |
| `src/industries/_shared/features/email-campaigns/ui/email-campaigns-dashboard.tsx` | Dialog | 2 | Delete Blast; Rename Blast | `` |
| `src/industries/_shared/features/email-campaigns/ui/recipients-preview-dialog.tsx` | Dialog | 1 | Preview recipients | `max-w-2xl max-h-[85vh] overflow-y-auto` |
| `src/industries/_shared/features/email-campaigns/ui/send-confirm-dialog.tsx` | Dialog | 1 | Review &amp; send | `flex h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl` |
| `src/industries/_shared/features/email/components/bcc-address-panel.tsx` | Alert | 1 | Regenerate your BCC address? | `` |
| `src/industries/_shared/features/email/components/code-editor-pane.tsx` | Alert | 1 | Replace the current HTML? | `` |
| `src/industries/_shared/features/email/components/compose-email-dialog.tsx` | Dialog | 1 | `isReply ? "Reply" : "New email"` | `sm:max-w-[600px] max-h-[90vh] flex flex-col` |
| `src/industries/_shared/features/form-builder/components/form-list.tsx` | Dialog | 1 | Delete Form | `` |
| `src/industries/_shared/features/form-builder/components/utm-link-list.tsx` | Dialog | 1 | Delete this tracking link? | `` |
| `src/industries/_shared/features/insights/components/dashboard-builder-dialog.tsx` | Dialog | 1 | `editing ? "Edit Dashboard" : "New Dashbo` | `max-w-lg max-h-[90vh] overflow-y-auto` |
| `src/industries/_shared/features/outreach/ui/bulk-draft-dialog.tsx` | Dialog | 1 | `title` | `max-w-md` |
| `src/industries/_shared/features/outreach/ui/bulk-enroll-dialog.tsx` | Dialog | 1 |   | `` |
| `src/industries/_shared/features/outreach/ui/draft-review-panel.tsx` | Dialog | 3 | Schedule this email; Send this email now?; Save as template | `sm:max-w-md / sm:max-w-lg` |
| `src/industries/_shared/features/outreach/ui/enrollments-table.tsx` | Alert | 1 | Unenroll this lead? | `` |
| `src/industries/_shared/features/outreach/ui/lead-cadence-strip.tsx` | Alert | 1 | Unenroll from &ldquo;{sequenceName}&rdquo;? | `` |
| `src/industries/_shared/features/outreach/ui/sequence-editor-dialog.tsx` | Alert+Dialog | 3 | Full preview — Step {(previewIndex ?? 0) + 1}; Switch to Rich text?; `isEdit ? (isSms ? "E | `sm:max-w-4xl max-h-[90vh] flex flex-col / flex h-[92vh] w-[96vw] max-w-none flex-col gap-3` |
| `src/industries/_shared/features/outreach/ui/sequence-pause-dialog.tsx` | Alert | 1 |  {action === "pause" ? "Pause" : "Resume"} everyone in &ldquo;{sequence?.name}&rdquo;?; `a | `` |
| `src/industries/_shared/features/outreach/ui/sequence-report-dialog.tsx` | Dialog | 1 | Report — {sequence?.name} | `max-w-2xl max-h-[85vh] overflow-y-auto` |
| `src/industries/_shared/features/outreach/ui/sequences-manager.tsx` | Alert | 2 | Who should get &ldquo;{justCreated?.name}&rdquo;?; Archive &ldquo;{archiveTarget?.name}&rd | `` |
| `src/industries/_shared/features/outreach/ui/sms-draft-review-panel.tsx` | Dialog | 1 |  {leadName}; `leadName` | `max-w-lg` |
| `src/industries/_shared/features/sms/ui/cost-preview-dialog.tsx` | Dialog | 1 | Cost preview | `max-w-lg max-h-[85vh] overflow-y-auto` |
| `src/industries/_shared/features/sms/ui/recipients-preview-dialog.tsx` | Dialog | 1 | Preview recipients | `max-w-2xl max-h-[85vh] overflow-y-auto` |
| `src/industries/_shared/features/sms/ui/send-confirm-dialog.tsx` | Dialog | 1 | Confirm send | `max-w-md` |
| `src/industries/education-consultancy/features/affiliates/ui.tsx` | Dialog | 1 | `editing ? "Edit Affiliate" : "Add Affili` | `sm:max-w-md` |
| `src/industries/education-consultancy/features/applicant-documents/document-upload-dialog.tsx` | Dialog | 1 | Upload document | `sm:max-w-sm` |
| `src/industries/education-consultancy/features/applicant-documents/documents-card.tsx` | Dialog | 1 | `viewerDoc?.name` | `sm:max-w-2xl` |
| `src/industries/education-consultancy/features/applicant-documents/multi-document-upload-dialog.tsx` | Dialog | 1 | Attach documents | `sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0` |
| `src/industries/education-consultancy/features/application-tracking/components/add-university-with-programs-dialog.tsx` | Dialog | 1 | Add University | `max-w-md` |
| `src/industries/education-consultancy/features/application-tracking/components/applications-column-manager.tsx` | Dialog | 1 | Choose which columns you see | `max-w-sm p-0 gap-0` |
| `src/industries/education-consultancy/features/application-tracking/components/autocomplete-input.tsx` | Alert | 1 | Create &quot;{pendingCreate}&quot;? | `` |
| `src/industries/education-consultancy/features/application-tracking/components/consent-card.tsx` | Dialog | 2 | Send consent with missing details?; Signed Consent Document | `max-w-md / max-w-3xl` |
| `src/industries/education-consultancy/features/application-tracking/components/in-person-consent-dialog.tsx` | Dialog | 1 |  | `max-w-2xl max-h-[90vh] overflow-y-auto p-0` |
| `src/industries/education-consultancy/features/application-tracking/components/pipeline/application-pipeline-settings-modal.tsx` | Dialog | 2 | Pipeline Settings; Delete Stage | `sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col / sm:max-w-[400px]` |
| `src/industries/education-consultancy/features/application-tracking/components/pipeline/application-stage-editor.tsx` | Dialog | 1 | `mode === "add" ? "Add Stage" : "Edit Sta` | `sm:max-w-[400px]` |
| `src/industries/education-consultancy/features/application-tracking/components/pipeline/create-application-pipeline-modal.tsx` | Dialog | 1 | Create Application Pipeline | `sm:max-w-[425px]` |
| `src/industries/education-consultancy/features/application-tracking/components/send-consent-dialog.tsx` | Dialog | 1 | Student Consent | `max-w-md` |
| `src/industries/education-consultancy/features/application-tracking/pages/application-detail.tsx` | Dialog | 1 | Delete application? | `` |
| `src/industries/education-consultancy/features/archived-lookup/components/archived-lead-preview-dialog.tsx` | Dialog | 1 |   | `sm:max-w-md` |
| `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx` | Dialog | 2 | Override Result; Public Leaderboard Settings | `max-w-sm / max-w-lg` |
| `src/industries/education-consultancy/features/classes/components/classes-card.tsx` | Dialog | 1 | Mark as paid | `sm:max-w-sm` |
| `src/industries/education-consultancy/features/classes/pages/classes-workspace.tsx` | Dialog | 1 | Edit fee | `sm:max-w-sm` |
| `src/industries/education-consultancy/features/lead-types/manager.tsx` | Dialog | 1 | `editing ? "Rename lead type" : "Add lead` | `` |
| `src/industries/education-consultancy/features/student-record/components/personal-details-dialog.tsx` | Alert+Dialog | 2 | Student Details; `confirm === "save" ? "Save these changes` | `w-[95vw] sm:max-w-5xl p-0 gap-0 flex flex-col max-h-[85vh] / ` |
| `src/industries/it-agency/features/accounts/components/account-form.tsx` | Dialog | 1 | `isEdit ? "Edit Account" : "New Account"` | `max-w-md` |
| `src/industries/it-agency/features/accounts/pages/account-detail.tsx` | Dialog | 1 | Delete account? | `` |
| `src/industries/it-agency/features/accounts/pages/accounts-list.tsx` | Dialog | 1 | Delete Account | `` |
| `src/industries/it-agency/features/approvals/pages/approvals-inbox.tsx` | Dialog | 1 | Reject {rejectTarget ? KIND_LABEL[rejectTarget.kind] : ""} | `max-w-sm` |
| `src/industries/it-agency/features/crm-contacts/components/contact-form.tsx` | Dialog | 1 | `isEdit ? "Edit Contact" : "New Contact"` | `max-w-md` |
| `src/industries/it-agency/features/crm-contacts/components/convert-lead-dialog.tsx` | Dialog | 1 | Convert to Contact | `max-w-md` |
| `src/industries/it-agency/features/crm-contacts/components/project-contact-picker.tsx` | Dialog | 1 |  {mode === "pick-project" ? "Add to Project" : "Add Contact"}; `mode === "pick-project" ?  | `max-w-md` |
| `src/industries/it-agency/features/crm-contacts/pages/contact-detail.tsx` | Dialog | 2 | Remove Project Link; Delete Contact | `` |
| `src/industries/it-agency/features/deals/components/create-deal-pipeline-modal.tsx` | Dialog | 1 | Create Deal Pipeline | `sm:max-w-[425px]` |
| `src/industries/it-agency/features/deals/components/deal-contact-picker.tsx` | Dialog | 1 | Add Contact | `max-w-md` |
| `src/industries/it-agency/features/deals/components/deal-pipeline-settings-modal.tsx` | Dialog | 2 | Pipeline Settings; Delete Stage | `sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col / sm:max-w-[400px]` |
| `src/industries/it-agency/features/deals/components/deal-stage-editor.tsx` | Dialog | 1 | `mode === "add" ? "Add Stage" : "Edit Sta` | `sm:max-w-[400px]` |
| `src/industries/it-agency/features/deals/pages/deal-detail.tsx` | Dialog | 3 | Remove Contact; Convert to Project; Delete deal? | `` |
| `src/industries/it-agency/features/project-board/components/cockpit/contacts-section.tsx` | Dialog | 1 | Remove Contact | `` |
| `src/industries/it-agency/features/project-board/components/cockpit/status-reports-panel.tsx` | Dialog | 1 | Share status report | `` |
| `src/industries/it-agency/features/project-board/components/project-form.tsx` | Dialog | 1 | `isEdit ? "Edit Project" : "New Project"` | `max-w-md` |
| `src/industries/it-agency/features/project-board/components/task-create-dialog.tsx` | Dialog | 1 | New task | `max-w-md` |
| `src/industries/it-agency/features/proposals/pages/proposal-detail.tsx` | Dialog | 4 | Share proposal; Add custom line; Mark proposal accepted?; Delete proposal? | `` |
| `src/industries/it-agency/features/resourcing/pages/resourcing-board.tsx` | Dialog | 1 | Allocate member to project | `` |
| `src/industries/it-agency/features/services/components/service-form.tsx` | Dialog | 1 | `isEdit ? "Edit Service" : "New Service"` | `max-w-md` |
| `src/industries/it-agency/features/services/pages/services-list.tsx` | Dialog | 1 | Delete Service | `` |
| `src/industries/it-agency/features/time-tracking/components/log-time-dialog.tsx` | Dialog | 1 | Log Time | `max-w-lg` |
| `src/industries/it-agency/features/time-tracking/components/time-entry-row.tsx` | Dialog | 1 | Edit Time Entry | `max-w-sm` |
| `src/industries/it-agency/features/time-tracking/components/timesheet-row.tsx` | Dialog | 2 | Edit Time Entry; Reject Time Entry | `max-w-sm` |
| `src/industries/it-agency/features/time-tracking/pages/approvals-queue.tsx` | Dialog | 2 | Reject Time Entry; Reject {selected.size} entries | `max-w-sm` |
| `src/industries/real-estate/features/investors/components/commitments-panel.tsx` | Dialog | 1 | Add Commitment | `max-w-md` |
| `src/industries/real-estate/features/investors/components/investor-comms-card.tsx` | Dialog | 1 |   | `max-w-lg` |
| `src/industries/real-estate/features/offerings/components/add-investor-dialog.tsx` | Dialog | 1 | Add Investor to Raise | `max-w-md` |
| `src/industries/real-estate/features/offerings/components/create-offering-dialog.tsx` | Dialog | 1 | New Offering | `max-w-lg` |
