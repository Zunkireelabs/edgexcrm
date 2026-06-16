export type Plan = "starter" | "professional" | "enterprise";

export interface Entitlements {
  maxBranches: number;
  maxSeats: number;
  multiPipeline: boolean;
  apiAccess: boolean;
}

const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  starter:      { maxBranches: 1,        maxSeats: 5,        multiPipeline: false, apiAccess: false },
  professional: { maxBranches: 1,        maxSeats: 25,       multiPipeline: true,  apiAccess: true  },
  enterprise:   { maxBranches: Infinity, maxSeats: Infinity, multiPipeline: true,  apiAccess: true  },
};

export function resolveEntitlements(tenant: {
  plan?: string | null;
  entitlement_overrides?: Record<string, unknown> | null;
}): Entitlements {
  const base = PLAN_ENTITLEMENTS[(tenant.plan as Plan) ?? "starter"] ?? PLAN_ENTITLEMENTS.starter;
  return { ...base, ...(tenant.entitlement_overrides ?? {}) };
}
