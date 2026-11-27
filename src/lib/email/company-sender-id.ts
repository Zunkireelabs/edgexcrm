/**
 * The `from_account_id` value that selects the tenant's verified company sender
 * in POST /api/v1/email/send (instead of a connected Gmail account's UUID).
 * Lives in a neutral module so both the server route and the client dialog can
 * import the same value (a "use client" module can't safely export it to server code).
 */
export const COMPANY_SENDER_ID = "company";
