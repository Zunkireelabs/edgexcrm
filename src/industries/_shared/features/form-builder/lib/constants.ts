// Public form distribution links must always load from production so that
// same-origin submissions (POST /api/v1/leads) land in the prod DB, regardless
// of which deployment the admin generated the link from. Mirrors CAMPAIGN_PUBLIC_BASE_URL.
export const FORM_PUBLIC_BASE_URL = "https://edgex.zunkireelabs.com";
