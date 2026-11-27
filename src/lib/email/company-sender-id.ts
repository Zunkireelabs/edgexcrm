/**
 * The `from_account_id` value that selects the tenant's verified company sender
 * in POST /api/v1/email/send (instead of a connected Gmail account's UUID).
 * Lives in a neutral module so both the server route and the client dialog can
 * import the same value (a "use client" module can't safely export it to server code).
 */
export const COMPANY_SENDER_ID = "company";

/**
 * The `from_account_id` value that selects the tenant's NO-REPLY sender (a second address on the same verified domain, e.g.
 * no-reply@mail.admizz.com). Emails sent from it are wrapped in the branded layout (template/branded-message.ts). It is only
 * valid for a NEW email, never a reply, and only when the tenant has it set up (no-reply-sender.ts).
 */
export const NO_REPLY_SENDER_ID = "no-reply";
