export { dispatchNotificationEmail } from "./dispatch";
export { renderEmailLayout, escapeHtml } from "./base-layout";
export { resolveRecipients, resolveUserRecipients } from "./recipients";
export { newLeadEvent } from "./events/new-lead";
export type { NewLeadAlertPayload } from "./events/new-lead";
export { consentSignedEvent } from "./events/consent-signed";
export type { ConsentSignedAlertPayload } from "./events/consent-signed";
export type { NotificationEmailEvent, NotifyRecipient, NotifyTenant, NotifyMessage, DispatchSummary } from "./types";
