# Graph Report - /Users/sadinshrestha/Projects/edgeXcrm/src  (2026-07-15)

## Corpus Check
- Large corpus: 909 files · ~447,787 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4100 nodes · 20529 edges · 168 communities (164 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166

## God Nodes (most connected - your core abstractions)
1. `apiSuccess()` - 634 edges
2. `apiUnauthorized()` - 627 edges
3. `authenticateRequest()` - 622 edges
4. `apiForbidden()` - 556 edges
5. `scopedClient()` - 475 edges
6. `apiError()` - 465 edges
7. `getFeatureAccess()` - 455 edges
8. `createRequestLogger()` - 435 edges
9. `apiNotFound()` - 413 edges
10. `apiValidationError()` - 316 edges

## Surprising Connections (you probably didn't know these)
- `RegisterPageContent()` --calls--> `createClient()`  [EXTRACTED]
  app/(main)/(auth)/register/page.tsx → lib/supabase/client.ts
- `PhoneInput()` --indirect_call--> `num()`  [INFERRED]
  components/ui/phone-input.tsx → app/(main)/(dashboard)/itineraries/page.tsx
- `isPositiveInt()` --indirect_call--> `num()`  [INFERRED]
  lib/api/validation.ts → app/(main)/(dashboard)/itineraries/page.tsx
- `OrcaComparePage()` --calls--> `getCurrentUserTenant()`  [EXTRACTED]
  app/(main)/(dashboard)/orca/compare/page.tsx → lib/supabase/queries.ts
- `OrcaRolesPage()` --calls--> `getCurrentUserTenant()`  [EXTRACTED]
  app/(main)/(dashboard)/orca/roles/page.tsx → lib/supabase/queries.ts

## Import Cycles
- 3-file cycle: `lib/api/audit.ts -> lib/webhooks/dispatcher.ts -> lib/api/integration-helpers.ts -> lib/api/audit.ts`
- 4-file cycle: `lib/api/audit.ts -> lib/webhooks/dispatcher.ts -> lib/api/integration-helpers.ts -> lib/api/integration-auth.ts -> lib/api/audit.ts`

## Communities (168 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (226): ActivityItem, GET(), lookupEmail(), Props, BillableRow, GET(), Props, sumEntries() (+218 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (144): PATCH(), ProjectStatusMix, Props, POST(), POST(), VALID_AGENT_TYPES, POST(), minLength() (+136 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (87): DELETE(), PATCH(), PATCH(), POST(), Props, POST(), Props, DELETE() (+79 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (80): POST(), POST(), PATCH(), POST(), regularize(), STATUSES, AttendanceRecordRow, GET() (+72 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (66): AccountDetailRoute(), Props, AccountsRoute(), AffiliatesRoute(), ApprovalsInboxRoute(), ApprovalsTimeEntriesRoute(), CampaignDetailRoute(), Props (+58 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (67): BranchSwitcherProps, Department, EmployeeProfile, EmployeeRow, EmployeeSkill, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, PHOTO_ACCEPTED_TYPES (+59 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (60): DELETE(), GET(), PATCH(), Props, GET(), GET(), GET(), DELETE() (+52 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (60): GET(), GET(), slugify(), VALID_FUNNEL_KEYS, validateAccess(), validateFunnelKey(), GET(), ApplicationsRoute() (+52 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (56): POST(), POST(), CORS_STATIC_HEADERS, POST(), withCors(), CORS_HEADERS, handlePost(), POST() (+48 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (50): GET(), generateMockResponse(), MOCK_RESPONSES, POST(), AttendancePage(), CheckInDetailRoute(), HomePage(), Cf (+42 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (31): aiConfig, affiliatesMeta, applicationTrackingMeta, campaignsMeta, classesMeta, contactsMeta, aiConfig, accountsMeta (+23 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (49): ActivityItem(), ActivityTab(), ActivityTabProps, ChangesDisplay(), formatFieldName(), formatValue(), getActivityDisplay(), groupByDate() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (40): ApprovalsSummary, TeamMember, UtilizationRow, SummaryRow, daysOverdue(), DeliveryOverdueTasksWidget(), ProjectEmbed, projectOf() (+32 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (46): LeadsByCounselorChart(), LeadsByCounselorChartProps, CHART_COLORS, LeadsBySourceChart(), LeadsBySourceChartProps, CHART_COLORS, LeadsByStageChart(), LeadsByStageChartProps (+38 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (34): ApprovalsPendingWidget(), DeliveryBenchWidget(), DeliveryByDepartmentWidget(), MyTasksWidget(), TaskProgressWidget(), AgingBucket, BUCKET_COLORS, BUCKET_LABELS (+26 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (40): POST, GET, POST, GET, PATCH, UPDATABLE_FIELDS, GET, POST (+32 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (22): AddNoteDialogProps, KBItem, STATUS_OPTIONS, KBItem, KnowledgeBaseItemsTableProps, SUGGESTIONS, EmailSenderSettings, LookupFormState (+14 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (23): CHART_COLORS, EmailSnapshotCardProps, BranchesManagerProps, TeamMemberLite, ConsentTemplate, SlugStatus, Holiday, industryColors (+15 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (29): ApprovalRow, GET(), ProjectEmbed, projectOf(), POST(), Props, POST(), Props (+21 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (32): GET(), TenantUserRow, AllocationRow, currentWeekRange(), GET(), VALID_PRIORITIES, VALID_STATUSES, ComplianceRow (+24 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (30): CardDescription(), AttributionEditor(), AttributionEditorProps, AutoresponderEditor(), AutoresponderEditorProps, STANDARD_TOKENS, BrandingEditor(), BrandingEditorProps (+22 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (29): ApiKeysManager(), AgentsManager(), buildDefaultForm(), ChannelsCard(), buildDefault(), ConsentManager(), EmailRulesManager(), EmailSenderCard() (+21 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (37): resolveEffectiveRate(), ApprovalEntryRow(), DashboardBuilderDialogProps, DashboardSwitcherProps, AIActionType, AIFactorImpact, ApiErrorResponse, AuditLog (+29 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (33): AccountContact, ContactsTabProps, AccountContact, ContactKeyInfoSection(), ContactKeyInfoSectionProps, formatDate(), ContactSummaryCardProps, ContactTabs() (+25 more)

### Community 24 - "Community 24"
Cohesion: 0.10
Nodes (32): AddDealSheetProps, ColumnsState, DealBoard(), DealBoardProps, findDealColumn(), groupByStage(), DealCard(), DealCardProps (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (21): AddLinkDialogProps, KBItem, Branch, BranchesBlockProps, Membership, DIFF_FIELDS, ConnectResult, InboxChannel (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.10
Nodes (26): registry, CAPABILITIES, instagramAdapter, CAPABILITIES, messengerAdapter, CAPABILITIES, SandboxMessage, SandboxPayload (+18 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (28): PATCH(), ADMIN_ONLY_FIELDS, PATCH(), UPDATABLE_FIELDS, POSITION_ROUTE_MAP, POSITION_ROUTE_MAP_WITH_ADMIN, ASSIGN_CHAIN_POSITIONS, assignableTargetSlugs() (+20 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (28): OrcaComparePage(), CompareContent(), MOCK_HANDOFFS, MOCK_ORG_LAYERS, MOCK_STATS, MOCK_TASK_ROLES, HandoffsFlow(), HandoffsFlowProps (+20 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (27): CORS_HEADERS, GET(), maskName(), notFound(), CampaignRow, CampaignRow, DEFAULT_LEADERBOARD_FIELDS, annotateIntegrity() (+19 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (26): BranchSwitcher(), LeadFunnelNavGroup(), LeadFunnelNavGroupProps, LeadListsNavGroup(), LeadListsNavGroupProps, LeadsOrganiseNavGroup(), LeadsOrganiseNavGroupProps, dateBucket() (+18 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (25): RFC-5322, FormBuilderPageProps, FormListProps, processEmailForwardRules(), processFormAutoresponder(), getResendClient(), htmlEscape(), renderTemplate() (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (28): ProjectFormProps, DeliveryHealthContent(), DeliveryHealthWidget(), DeliveryProject, RAG_LABELS, TeamMemberMinimal, bucketFor(), DeliveryOverrunWidget() (+20 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (28): AssigneePickerProps, initials(), OwnerPicker(), OwnerPickerProps, getDaysSinceUpdate(), getUrgencyStyles(), ownerInitials(), ProjectCard() (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.08
Nodes (29): computeNightsFromStored(), TripInquiryPanel(), ChangeRequestRow(), MilestoneRow(), waitingAge(), DealDetailPage(), formatDate(), rolePill() (+21 more)

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (24): OrgLayerWithPositions, OrgStructureContent(), OrgStructureContentProps, ViewMode, EditState, OrgStructureEditor(), OrgStructureEditorProps, OrgStructureHierarchy() (+16 more)

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (24): HealthSnapshotCardProps, ProjectStatusMix, STATUS_ORDER, AccountContact, Lead, leadName(), OverviewTab(), OverviewTabProps (+16 more)

### Community 37 - "Community 37"
Cohesion: 0.10
Nodes (24): AddLeadSheetProps, ArchiveNavLinks(), ArchiveNavLinksProps, KeyInfoSectionProps, LeadDetailV2Props, ListStepperProps, MoveToListSelectorProps, QualifyRowButtonProps (+16 more)

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (24): AttentionSummary(), AttentionSummaryProps, EmailSnapshotCard(), HomeContent(), HomeContentProps, MyTimeWidget, MyUtilizationWidget, InboxSnapshotCard() (+16 more)

### Community 39 - "Community 39"
Cohesion: 0.10
Nodes (22): BranchesBlock(), CollaboratorsBlock(), CONTACT_METHODS, COUNTRIES, formatFieldLabel(), formatRelativeTime(), getInitials(), KeyInfoSection() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.14
Nodes (18): AddLeadSheet(), CONTACT_METHODS, FormData, FormErrors, initialFormData, TeamMember, LeadDraftSubset, LeadTypeOption (+10 more)

### Community 41 - "Community 41"
Cohesion: 0.15
Nodes (20): AttendanceWorkspace(), AttendanceWorkspaceProps, LeaveWorkspace(), LeaveWorkspaceProps, MyLeavePanel(), FilterDropdownProps, FilterOption, FilterOptionList() (+12 more)

### Community 42 - "Community 42"
Cohesion: 0.10
Nodes (18): TeamMember, AgentFormState, AgentRow, Invite, Position, roleColors, TeamManagementProps, TeamMember (+10 more)

### Community 43 - "Community 43"
Cohesion: 0.11
Nodes (21): formatDate(), formatFieldValue(), MergeDialog(), ColumnManagerDialog(), ColumnManagerDialogProps, getDefaultVisibleKeys(), getLeadColumns(), humanizeKey() (+13 more)

### Community 44 - "Community 44"
Cohesion: 0.10
Nodes (23): ListKanbanView(), ListKanbanViewProps, TeamMember, CreatePipelineModal(), CreatePipelineModalProps, PipelineSelector(), PipelineSelectorProps, PipelineSettingsModal() (+15 more)

### Community 45 - "Community 45"
Cohesion: 0.13
Nodes (16): DEFAULT_FORM, PipelineOption, PLACEHOLDERS, RuleFormData, StageOption, Checkbox(), DialogFooter(), DialogTrigger() (+8 more)

### Community 46 - "Community 46"
Cohesion: 0.11
Nodes (24): TaskRow(), LogTimeDialogProps, RunningTimersPanel(), RunningTimersPanelProps, minutesToHoursInput(), TaskRow(), TimeEntryAddFormProps, TimeEntryRowProps (+16 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (20): healthCounts(), overBudgetCount(), OverviewDeliveryContent(), OverviewDeliveryWidget(), RAG_LABELS, RAG_ORDER, TERMINAL_STATUSES, UtilizationRow (+12 more)

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (12): Button(), buttonVariants, ContactRow, DealContactPickerProps, DealContactRole, PickContactResult, ROLE_OPTIONS, TipTapEditor() (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (19): ProjectsRoute(), ProjectsRouteProps, TasksWorkspaceHeader(), TableView(), buildQuery(), TasksView(), WorkspaceHeader(), useProjects() (+11 more)

### Community 50 - "Community 50"
Cohesion: 0.18
Nodes (18): ApiKeyRow, ApiKeyScope, ApiKeysManagerProps, CreatedKeyResponse, DialogDescription(), Table(), TableBody(), TableCell() (+10 more)

### Community 51 - "Community 51"
Cohesion: 0.12
Nodes (21): InfoRow(), InfoRowProps, InfoSection(), InfoSectionProps, Avatar(), AvatarBadge(), AvatarFallback(), AvatarGroup() (+13 more)

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (18): AccountCard(), AccountCardProps, AccountSibling, ContactRelatedPanel(), ContactRelatedPanelProps, ProjectContactRole, ProjectLink, SourceLead (+10 more)

### Community 53 - "Community 53"
Cohesion: 0.10
Nodes (17): AcademicOperationsPanel, AiOrcaPanel, CommunicationsPanel, CompliancePanel, GeneralPanel, IntegrationsPanel, LeadManagementPanel, LeavePanel (+9 more)

### Community 54 - "Community 54"
Cohesion: 0.14
Nodes (19): TimeEntryAddForm(), todayISO(), Account, last4wRange(), PRESETS, Project, TeamMember, thisMonthRange() (+11 more)

### Community 55 - "Community 55"
Cohesion: 0.18
Nodes (17): AccountRelatedPanel(), AccountRelatedPanelProps, Lead, AccountTeam, AccountTeamCard(), AccountTeamCardProps, getInitialsFromEmail(), isLastActiveTooOld() (+9 more)

### Community 56 - "Community 56"
Cohesion: 0.14
Nodes (17): AccountContact, AccountTabs(), AccountTabsProps, ActivityData, Lead, ActivityItem, ActivityRow(), getEventDisplay() (+9 more)

### Community 57 - "Community 57"
Cohesion: 0.16
Nodes (14): TemplatePickerProps, admissionInquiryTemplate, counselingBookingTemplate, generalContactTemplate, ALL_NAMED_TEMPLATES, BLANK_TEMPLATE, EDUCATION_CONSULTANCY_TEMPLATES, getTemplateById() (+6 more)

### Community 58 - "Community 58"
Cohesion: 0.12
Nodes (17): getClientIpFromHeaders(), metadata, PageProps, PublicStatusReportPage(), formatDate(), HEALTH_DOT, HEALTH_LABEL, PublicStatusReport() (+9 more)

### Community 59 - "Community 59"
Cohesion: 0.17
Nodes (15): GlobalSearchPalette(), ICON_MAP, leadDisplayName(), LeadResult, matchNav(), Command(), CommandDialog(), CommandDialogProps (+7 more)

### Community 60 - "Community 60"
Cohesion: 0.14
Nodes (15): DialogTitle(), ConsentCard(), ConsentCardProps, ConsentStatus, FeeStatus, ConsentSessionData, InPersonConsentDialog(), InPersonConsentDialogProps (+7 more)

### Community 61 - "Community 61"
Cohesion: 0.17
Nodes (14): ChangeRequestPrefill, ChangeRequestsPanel(), ChangeRequestsPanelProps, STATUS_CONFIG, DeliveryTab(), DeliveryTabProps, AiReadSignals(), useProjectChangeRequests() (+6 more)

### Community 62 - "Community 62"
Cohesion: 0.18
Nodes (16): formatTime(), monthRange(), MyAttendancePanel(), RegularizeDialog(), RegularizeDialogProps, toTimeInput(), formatTime(), monthRange() (+8 more)

### Community 63 - "Community 63"
Cohesion: 0.15
Nodes (16): ComposeEmailDialog, EmailThreadCard, formatDayLabel(), formatTimeOnly(), getSystemActivityDescription(), getSystemActivityIcon(), groupByDay(), resolveActorLabel() (+8 more)

### Community 64 - "Community 64"
Cohesion: 0.18
Nodes (15): EMPTY_SELECTIONS, FILTER_CHIP_LABELS, Selections, UtmAnalyticsSection(), UtmAnalyticsSectionProps, CHART_COLORS, truncate(), UtmBarChart() (+7 more)

### Community 65 - "Community 65"
Cohesion: 0.16
Nodes (13): BranchesManager(), CountriesManager(), CoursesManager(), getExampleName(), IndustryEntitiesManager(), IntakeMonthsManager(), IntakeYearsManager(), buildDefaultForm() (+5 more)

### Community 66 - "Community 66"
Cohesion: 0.15
Nodes (14): Popover(), PopoverContent(), PopoverDescription(), PopoverHeader(), PopoverTitle(), ContactForm(), ContactsListPage(), ContactsListPageProps (+6 more)

### Community 67 - "Community 67"
Cohesion: 0.21
Nodes (17): calculateLeadScore(), formatRelativeTime(), generateEngagementStats(), generateLeadInsights(), generateRecommendedActions(), generateSummary(), getDaysSince(), getLastActivityDate() (+9 more)

### Community 68 - "Community 68"
Cohesion: 0.18
Nodes (14): checkConversationAccess(), GET(), POST(), decryptToken(), encryptToken(), loadKey(), AiAuthor, ChannelRow (+6 more)

### Community 69 - "Community 69"
Cohesion: 0.18
Nodes (13): DELETE(), PATCH(), Props, POST(), Props, DELETE(), DISCOUNT_TYPES, PATCH() (+5 more)

### Community 70 - "Community 70"
Cohesion: 0.18
Nodes (13): AddLinkDialog(), AddNoteDialog(), KBItem, KnowledgeBase, KnowledgeBaseDetail(), KnowledgeBaseDetailProps, FileUploadState, KBItem (+5 more)

### Community 71 - "Community 71"
Cohesion: 0.16
Nodes (12): ChatInput(), ChatInputProps, ChatMessage(), ChatMessageProps, AIAssistantPanel(), createWelcomeMessage(), Message, TypingIndicator() (+4 more)

### Community 72 - "Community 72"
Cohesion: 0.17
Nodes (13): NewTaskRow(), NewTaskRowProps, initials(), MemberPicker(), MemberPickerProps, RosterMember, PRIORITY_OPTIONS, TaskComposer() (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (10): NextPositionMember, ReconciliationPanel(), ReconciliationPanelProps, Tooltip(), TooltipContent(), TooltipProvider(), TooltipTrigger(), TruncatedTextProps (+2 more)

### Community 74 - "Community 74"
Cohesion: 0.21
Nodes (13): formatHours(), ReconciliationPanel(), ReconciliationPanelProps, varianceColor(), ReportsTab(), ReportsTabProps, TimelinePanelProps, ReconciliationRollup (+5 more)

### Community 75 - "Community 75"
Cohesion: 0.19
Nodes (14): FieldEditor(), FieldEditorProps, DEFAULT_META, FIELD_META, FieldRow(), FieldRowProps, buildDefaultField(), FIELD_TYPES (+6 more)

### Community 76 - "Community 76"
Cohesion: 0.32
Nodes (13): EmailThread, matchInboundToThread(), persistRefreshedToken(), pollOneAccount(), POST(), createOAuth2Client(), getMessage(), htmlToText() (+5 more)

### Community 77 - "Community 77"
Cohesion: 0.19
Nodes (13): MyTask, TaskRowItem, TaskRowProps, PRIORITY_ORDER, TasksSummaryCard(), TasksSummaryCardProps, PRIORITIES, PRIORITY_CONFIG (+5 more)

### Community 78 - "Community 78"
Cohesion: 0.23
Nodes (13): EntryWithJoins, BillableSummary(), BillableSummaryProps, Tile, TimesheetStatsCards(), calculateBillableAmount(), calculateBillableMinutes(), calculateCostAmount() (+5 more)

### Community 80 - "Community 80"
Cohesion: 0.20
Nodes (14): ActivitiesPanelProps, LeadDetailProps, ComposeEmailDialogProps, EmailThreadCard(), EmailThreadCardProps, formatRelativeTime(), formatTimestamp(), getInitial() (+6 more)

### Community 81 - "Community 81"
Cohesion: 0.20
Nodes (13): EditErrors, LeadDetailV2(), LeadDraft, makeDraft(), TeamMember, LeadTabs, ManagementPanel, useEduTaxonomy() (+5 more)

### Community 82 - "Community 82"
Cohesion: 0.13
Nodes (14): DealContactPicker(), ContactLink, CURRENCIES, DEAL_TYPES, DealContactRole, DealDetailPageProps, PRIORITIES, PROJECT_STATUSES (+6 more)

### Community 83 - "Community 83"
Cohesion: 0.23
Nodes (14): TimeEntryRow(), TimesheetRow(), TimesheetTable(), buildUrl(), DateGroup, formatDateLabel(), formatMinutes(), groupByWeek() (+6 more)

### Community 84 - "Community 84"
Cohesion: 0.14
Nodes (11): OrcaStructurePage(), EditorViewProps, HierarchyRoleCard(), HierarchyViewProps, INITIAL_LAYERS, Layer, Role, RoleCard() (+3 more)

### Community 85 - "Community 85"
Cohesion: 0.20
Nodes (12): getClientIpFromHeaders(), metadata, PageProps, PublicProposalPage(), formatDate(), ProposalDocument(), ProposalDocumentBranding, ProposalDocumentData (+4 more)

### Community 86 - "Community 86"
Cohesion: 0.18
Nodes (12): Channel, ConversationList(), ConversationListProps, ConversationRow, formatRelative(), providerLabel(), Channel, ConversationRow (+4 more)

### Community 87 - "Community 87"
Cohesion: 0.19
Nodes (13): AIInsightsTabProps, escapeRegExp(), formatExactStamp(), getInitials(), MentionUser, NoteCard(), NotesTab, NotesTabProps (+5 more)

### Community 88 - "Community 88"
Cohesion: 0.19
Nodes (12): ColumnsState, FunnelKanbanBoard(), FunnelKanbanBoardProps, groupByList(), listToStage(), LeadCardProps, MoveToPipelineModalProps, PipelineBoardProps (+4 more)

### Community 89 - "Community 89"
Cohesion: 0.21
Nodes (13): clearFilter(), FilterChips(), FilterMenu(), FilterMenuProps, filterSummary(), isFilterActive(), ServiceForm(), BILLING_TYPE_LABEL (+5 more)

### Community 90 - "Community 90"
Cohesion: 0.23
Nodes (11): FormOption, UtmBuilderPageClient(), UtmBuilderPageClientProps, buildTrackingUrl(), FormOption, UtmLinkBuilder(), UtmLinkBuilderProps, UtmLinkList (+3 more)

### Community 91 - "Community 91"
Cohesion: 0.19
Nodes (6): AIInsightsTab(), formatRelativeTime(), getScoreBadgeColor(), AISparkleIcon(), AISparkleIconLarge(), AISparkleIconProps

### Community 92 - "Community 92"
Cohesion: 0.22
Nodes (12): ContactCard(), LeadDetail(), FULLNAME_CUSTOM_KEYS, getLeadFullName(), getLeadInitials(), readFullnameCustomField(), formatRelativeTime(), getInitials() (+4 more)

### Community 93 - "Community 93"
Cohesion: 0.21
Nodes (13): SettingsFormProps, PublicFormProps, BootstrapData, resolveTab(), SettingsModalContext, SettingsModalContextValue, SettingsModalPortal, SettingsModalProvider() (+5 more)

### Community 94 - "Community 94"
Cohesion: 0.20
Nodes (10): EduTaxonomy, CheckInPage(), CheckInRecord, DateFilter, getDateRange(), LeadResult, DESTINATIONS, FIELDS_OF_STUDY (+2 more)

### Community 95 - "Community 95"
Cohesion: 0.19
Nodes (11): buildAgentPrompt(), Campaign, CampaignDetail(), EspnResult, EXAMPLE_RESPONSE, GearDialog(), LeaderboardData, outcomeLabel() (+3 more)

### Community 96 - "Community 96"
Cohesion: 0.16
Nodes (11): AccountSummaryCard(), AccountForm(), ProjectForm(), STATUS_OPTIONS, AccountDetailPage(), AccountDetailPageProps, BillableSummary, Lead (+3 more)

### Community 97 - "Community 97"
Cohesion: 0.16
Nodes (11): ActionRowProps, ApprovalRow, ApprovalsData, ApprovalsInboxPage(), ApprovalsInboxPageProps, APPROVE_PATH, formatHours(), groupTimeEntriesByMember() (+3 more)

### Community 98 - "Community 98"
Cohesion: 0.16
Nodes (8): PreviewPill(), DraftFields, formatSnapshotHours(), HEALTH_LABEL, SAMPLE_DRAFT, SECTION_FIELDS, StatusReportsPanel(), StatusReportsPanelProps

### Community 99 - "Community 99"
Cohesion: 0.21
Nodes (11): ChartConfig, ChartContainer(), ChartContext, ChartContextProps, ChartLegendContent(), ChartTooltipContent(), getPayloadConfigFromPayload(), INITIAL_DIMENSION (+3 more)

### Community 100 - "Community 100"
Cohesion: 0.24
Nodes (11): age(), BAND_CLASS, RisksPanel(), RisksPanelProps, STATUS_LABEL, RANK, riskBand, riskScore() (+3 more)

### Community 101 - "Community 101"
Cohesion: 0.21
Nodes (12): BackfillApplyResult, BackfillGroup, BackfillReport, ChildCounts, computeFieldDelta(), countChildRows(), planBackfill(), runBackfill() (+4 more)

### Community 102 - "Community 102"
Cohesion: 0.27
Nodes (10): GET(), loadSignatureImage(), lookupToken(), POST(), RouteContext, A4, ConsentPdfInput, generateConsentPdf() (+2 more)

### Community 103 - "Community 103"
Cohesion: 0.27
Nodes (11): DELETE(), GET(), handleUniqueViolation(), hasDealsAndContactsAccess(), PATCH(), POST(), Props, RawContactRow (+3 more)

### Community 104 - "Community 104"
Cohesion: 0.17
Nodes (9): FormState, LeadList, NavItem, Pipeline, Position, PositionPermissions, PositionsManagerProps, tierColors (+1 more)

### Community 105 - "Community 105"
Cohesion: 0.21
Nodes (8): AccountContact, AccountKeyInfoSection(), AccountKeyInfoSectionProps, BillableSummary, formatDate(), BillableDelta, DeltaDirection, formatBillableDelta()

### Community 106 - "Community 106"
Cohesion: 0.23
Nodes (9): AiSummaryCard(), BriefEditor(), QualifyPanel(), TasksSection(), TeamMember, useProjectCockpit(), AI_SYNTH_PREVIEW, ProjectCockpitPage() (+1 more)

### Community 107 - "Community 107"
Cohesion: 0.24
Nodes (11): StatusPill(), initials(), matchesDue(), MemberSection, MembersView(), MembersViewProps, TaskWithProject, TaskWithProject (+3 more)

### Community 108 - "Community 108"
Cohesion: 0.24
Nodes (9): GET(), MetaProvider, POST(), SUPPORTED_PROVIDERS, GET(), POST(), getAdapter(), sandboxAdapter (+1 more)

### Community 109 - "Community 109"
Cohesion: 0.22
Nodes (9): InvoiceRow, InvoiceDetailDrawer(), InvoicesPanel(), InvoicesPanelProps, STATUS_CONFIG, BillableMilestone, useProjectInvoices(), Invoice (+1 more)

### Community 110 - "Community 110"
Cohesion: 0.22
Nodes (8): CreateKnowledgeBaseModal(), CreateKnowledgeBaseModalProps, KnowledgeBase, KnowledgeBaseCard(), KnowledgeBaseCardProps, KnowledgeBase, KnowledgeBases(), KnowledgeBasesProps

### Community 111 - "Community 111"
Cohesion: 0.18
Nodes (6): DropdownMenuCheckboxItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuShortcut(), DropdownMenuSubContent(), DropdownMenuSubTrigger()

### Community 112 - "Community 112"
Cohesion: 0.22
Nodes (10): PopoverTrigger(), AccountFormProps, AccountWithExtras, AccountsListPage(), AccountsListPageProps, AccountWithCount, getInitials(), SortDirection (+2 more)

### Community 113 - "Community 113"
Cohesion: 0.20
Nodes (8): AgentOption, EMPTY, FALLBACK_COUNTRIES, fetchReferenceData(), loadReferenceData(), PartnerCollegeOption, ReferenceData, subscribers

### Community 114 - "Community 114"
Cohesion: 0.22
Nodes (8): AssigneePicker(), initials(), PRIORITY_ORDER, SortDir, SortKey, TASK_STATUS_LABELS, TaskRowProps, LogTimeDialog()

### Community 115 - "Community 115"
Cohesion: 0.20
Nodes (10): buildUrl(), ComplianceRange, ComplianceResponse, ComplianceRow, ComplianceStatus, ComplianceSummary, useCompliance(), CompliancePage() (+2 more)

### Community 116 - "Community 116"
Cohesion: 0.31
Nodes (7): GET(), Plan, PLAN_ENTITLEMENTS, resolveEntitlements(), buildNavCatalog(), UNIVERSAL_NAV, WIDGET_CATALOG

### Community 117 - "Community 117"
Cohesion: 0.31
Nodes (6): STATUS_VARIANT, TeamLeavePanel(), TeamLeavePanelProps, LeaveRequestRow, LeaveTypeOption, useLeaveApproveReject()

### Community 118 - "Community 118"
Cohesion: 0.20
Nodes (5): ActivitiesPanel, ActivitiesPanelRef, DuplicateSuggestion, InfoGridRowProps, LeadTabsRef

### Community 119 - "Community 119"
Cohesion: 0.33
Nodes (8): formatFieldLabel(), PROFESSIONAL_FIELDS, ProfessionalDetailsCard(), ProfessionalDetailsCardProps, EDUCATION_ONLY_PROMOTED_KEYS, isReservedCustomField(), PROMOTED_KEYS, NOTE: "hear_about" deliberately NOT reserved — no dedicated panel exists

### Community 120 - "Community 120"
Cohesion: 0.24
Nodes (8): ColumnsState, groupByStage(), PipelineBoard(), SortDirection, SortField, sortLeads(), TeamMember, TeamMemberData

### Community 121 - "Community 121"
Cohesion: 0.36
Nodes (8): RFC-822, extractBody(), getHeader(), parseAddress(), parseAddressList(), parseGmailMessage(), parseReferences(), text_fallback()

### Community 122 - "Community 122"
Cohesion: 0.28
Nodes (8): ACTIVITY_COLORS, ACTIVITY_ICONS, ActivityCard(), ActivityCardProps, CALL_OUTCOME_LABELS, LogActivityModalProps, ActivityType, LeadActivityRecord

### Community 123 - "Community 123"
Cohesion: 0.28
Nodes (7): ChecklistCard, ChecklistCardProps, formatRemind(), ManagementPanelProps, ManagementPanelRef, ReminderButton(), reminderPresets()

### Community 124 - "Community 124"
Cohesion: 0.28
Nodes (6): CopyButton(), CopyButtonProps, DropdownMenuTrigger(), ContactSummaryCard(), getInitials(), QuickActionButtonProps

### Community 125 - "Community 125"
Cohesion: 0.28
Nodes (8): IssuesPanel(), IssuesPanelProps, KIND_LABEL, SEVERITY_DOT, slaAge(), IssueKind, IssueSeverity, ProjectIssue

### Community 126 - "Community 126"
Cohesion: 0.22
Nodes (6): Allocation, EmployeeRow, EmployeeSkillRow, Project, Skill, TeamMember

### Community 127 - "Community 127"
Cohesion: 0.28
Nodes (7): buildReferencesChain(), buildReplySubject(), ComposeEmailDialog(), FromAccountPicker(), InboxConnector(), ConnectedInbox, useConnectedInboxes()

### Community 128 - "Community 128"
Cohesion: 0.42
Nodes (7): authenticateIntegrationRequest(), IntegrationAuthResult, logAuthFailure(), updateLastUsedThrottled(), generateApiKey(), hashApiKey(), verifyApiKeyHash()

### Community 129 - "Community 129"
Cohesion: 0.36
Nodes (5): AuthMode, isTransientNetworkError(), LoginPageContent(), sleep(), withRetry()

### Community 130 - "Community 130"
Cohesion: 0.25
Nodes (3): InviteData, RegisterPageContent(), TokenStatus

### Community 131 - "Community 131"
Cohesion: 0.32
Nodes (6): ConsentSignForm(), ConsentSignFormProps, ConsentData, ConsentTokenPage(), fetchConsentData(), PageProps

### Community 132 - "Community 132"
Cohesion: 0.29
Nodes (7): Agent, AGENT_ICONS, AgentsContent(), AgentStatus, AgentType, MOCK_AGENTS, STATUS_CONFIG

### Community 133 - "Community 133"
Cohesion: 0.29
Nodes (7): NavResult, GlobalSearchPaletteProps, GlobalSearchContext, GlobalSearchContextValue, GlobalSearchPalette, GlobalSearchProvider(), GlobalSearchProviderProps

### Community 134 - "Community 134"
Cohesion: 0.43
Nodes (7): formatDate(), getDaysInStage(), getInitials(), getUrgencyStyles(), LeadCard(), truncateText(), MoveToPipelineModal()

### Community 135 - "Community 135"
Cohesion: 0.39
Nodes (5): SortableStageItemProps, STAGE_COLORS, StageEditor(), StageEditorProps, PipelineStageWithCount

### Community 136 - "Community 136"
Cohesion: 0.29
Nodes (4): ApplicationsCard(), ApplicationsCardProps, StatusBadge(), StatusBadgeProps

### Community 137 - "Community 137"
Cohesion: 0.33
Nodes (6): GET(), Props, RawContactRow, ROLE_ORDER, ROLES, sortByRoleThenName()

### Community 138 - "Community 138"
Cohesion: 0.57
Nodes (5): DealsPageProps, DealsRoute(), getDealPipelines(), getDealPipelineStages(), getDealsForPipeline()

### Community 139 - "Community 139"
Cohesion: 0.38
Nodes (5): ResourcingUtilizationRoute(), barColor(), TeamMember, UtilizationDashboard(), UtilizationRow

### Community 140 - "Community 140"
Cohesion: 0.33
Nodes (4): geistMono, geistSans, metadata, Toaster()

### Community 141 - "Community 141"
Cohesion: 0.38
Nodes (6): ConversationRow, formatTime(), MessageRow, MessageThread(), MessageThreadProps, statusIcon()

### Community 142 - "Community 142"
Cohesion: 0.38
Nodes (5): buildDefaultForm(), ClassesManager(), ClassFormState, ClassRow, formatFee()

### Community 143 - "Community 143"
Cohesion: 0.29
Nodes (6): DropdownMenu(), DropdownMenuContent(), AddEnrollmentToLeadSheet(), ClassesCard(), ClassesCardProps, Enrollment

### Community 144 - "Community 144"
Cohesion: 0.33
Nodes (6): DropdownMenuItem(), ContactLink, ContactsSection(), ContactsSectionProps, ProjectContactRole, rolePill()

### Community 145 - "Community 145"
Cohesion: 0.33
Nodes (6): LIFECYCLE_ACTIONS, MilestonesPanel(), MilestonesPanelProps, STATUS_CONFIG, MilestoneStatus, ProjectMilestone

### Community 146 - "Community 146"
Cohesion: 0.38
Nodes (4): FormCreationWizardProps, ICON_MAP, TemplatePicker(), getTemplatesForIndustry()

### Community 147 - "Community 147"
Cohesion: 0.29
Nodes (5): sendGmailOAuth2Email(), SendGmailOAuth2Params, sendSmtpEmail(), SendSmtpEmailParams, SmtpResult

### Community 148 - "Community 148"
Cohesion: 0.60
Nodes (5): GET(), getRedirectUri(), getSettingsUrl(), verifyState(), getProfileEmail()

### Community 149 - "Community 149"
Cohesion: 0.47
Nodes (5): canEdit(), DELETE(), EntryRow, PATCH(), Props

### Community 150 - "Community 150"
Cohesion: 0.40
Nodes (4): OrcaRolesPage(), MOCK_ROLES, Role, RolesContent()

### Community 151 - "Community 151"
Cohesion: 0.40
Nodes (5): ListStepper(), ARCHIVE_REASONS, MOVE_CONFIRM_MESSAGES, moveConfirmMessage(), MoveToListSelector()

### Community 152 - "Community 152"
Cohesion: 0.33
Nodes (4): DropdownMenuSeparator(), AccountContact, AccountSummaryCardProps, QuickActionButtonProps

### Community 153 - "Community 153"
Cohesion: 0.33
Nodes (5): EnrollStudentSheet(), ClassesWorkspace(), ClassesWorkspaceProps, ClassRow, Enrollment

### Community 154 - "Community 154"
Cohesion: 0.53
Nodes (5): clearColumnPrefs(), loadColumnPrefs(), prefsKey(), saveColumnPrefs(), StoredPrefs

### Community 155 - "Community 155"
Cohesion: 0.60
Nodes (4): DELETE(), PATCH(), Props, canManageClasses()

### Community 156 - "Community 156"
Cohesion: 0.40
Nodes (3): { PATCH, DELETE }, { PATCH, DELETE }, createLookupTableItemRoutes()

### Community 157 - "Community 157"
Cohesion: 0.40
Nodes (3): { GET, POST }, { GET, POST }, createLookupTableListRoutes()

### Community 158 - "Community 158"
Cohesion: 0.40
Nodes (4): CURRENCY_OPTIONS, TenantLocaleManagerProps, TIMEZONE_OPTIONS, WEEKDAYS

### Community 159 - "Community 159"
Cohesion: 0.40
Nodes (5): ApprovalsQueuePage(), fourWeeksAgo(), groupByDate(), groupByMember(), startOfWeek()

### Community 160 - "Community 160"
Cohesion: 0.60
Nodes (3): updateSession(), config, middleware()

### Community 161 - "Community 161"
Cohesion: 0.50
Nodes (3): DELETE(), PATCH(), Props

### Community 162 - "Community 162"
Cohesion: 0.50
Nodes (3): ConvertBody, POST(), Props

### Community 163 - "Community 163"
Cohesion: 0.67
Nodes (3): getGreeting(), GreetingHeader(), GreetingHeaderProps

## Knowledge Gaps
- **1001 isolated node(s):** `AuthMode`, `TokenStatus`, `InviteData`, `Props`, `Props` (+996 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getFeatureAccess()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 137`, `Community 9`, `Community 138`, `Community 139`, `Community 10`, `Community 18`, `Community 19`, `Community 148`, `Community 149`, `Community 21`, `Community 27`, `Community 155`, `Community 29`, `Community 161`, `Community 162`, `Community 49`, `Community 65`, `Community 69`, `Community 103`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `Button()` connect `Community 48` to `Community 4`, `Community 5`, `Community 134`, `Community 135`, `Community 136`, `Community 9`, `Community 11`, `Community 141`, `Community 142`, `Community 143`, `Community 16`, `Community 17`, `Community 144`, `Community 145`, `Community 20`, `Community 146`, `Community 151`, `Community 23`, `Community 25`, `Community 153`, `Community 24`, `Community 158`, `Community 33`, `Community 34`, `Community 36`, `Community 39`, `Community 40`, `Community 42`, `Community 43`, `Community 44`, `Community 45`, `Community 46`, `Community 50`, `Community 51`, `Community 52`, `Community 54`, `Community 60`, `Community 61`, `Community 62`, `Community 63`, `Community 66`, `Community 70`, `Community 71`, `Community 72`, `Community 73`, `Community 74`, `Community 75`, `Community 80`, `Community 81`, `Community 82`, `Community 87`, `Community 89`, `Community 90`, `Community 91`, `Community 92`, `Community 94`, `Community 95`, `Community 96`, `Community 97`, `Community 98`, `Community 100`, `Community 104`, `Community 109`, `Community 110`, `Community 112`, `Community 117`, `Community 118`, `Community 119`, `Community 122`, `Community 123`, `Community 124`, `Community 125`, `Community 126`, `Community 127`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `createServiceClient()` connect `Community 6` to `Community 0`, `Community 1`, `Community 2`, `Community 128`, `Community 4`, `Community 3`, `Community 7`, `Community 8`, `Community 9`, `Community 138`, `Community 15`, `Community 18`, `Community 148`, `Community 27`, `Community 29`, `Community 31`, `Community 58`, `Community 68`, `Community 76`, `Community 85`, `Community 101`, `Community 102`, `Community 108`, `Community 116`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `AuthMode`, `TokenStatus`, `InviteData` to the rest of the system?**
  _1001 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03278856393872368 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05575426987391577 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.04729214340198322 - nodes in this community are weakly interconnected._