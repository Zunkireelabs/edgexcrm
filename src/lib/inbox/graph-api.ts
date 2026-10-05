// Single source of truth for the Meta Graph API version used by every WhatsApp Cloud
// API call (send, media resolve/download, media upload, template listing). Previously
// hardcoded separately wherever a call was made — centralised so a version bump is a
// one-line change instead of a grep.
export const GRAPH_API_VERSION = "v19.0";
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
