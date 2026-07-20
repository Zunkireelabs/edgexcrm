// Vision-only preview flag. NO real AI behind this. Remove/replace when the
// real AI-synth surface lands (docs/ai-native-efforts/).
export const AI_SYNTH_PREVIEW = {
  // ON only for the Zunkiree dogfood tenant + admins. Real tenants never see it.
  enabledFor(tenantSlug: string | null | undefined, isAdmin: boolean): boolean {
    return isAdmin && tenantSlug === "zunkireelabs-crm";
  },
} as const;
