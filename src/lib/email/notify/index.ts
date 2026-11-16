export { dispatchNotificationEmail } from "./dispatch";
export { renderEmailLayout, escapeHtml } from "./base-layout";
export { resolveRecipients } from "./recipients";
export { newLeadEvent } from "./events/new-lead";
export type { NewLeadAlertPayload } from "./events/new-lead";
export type { NotificationEmailEvent, NotifyRecipient, NotifyTenant, NotifyMessage, DispatchSummary } from "./types";
