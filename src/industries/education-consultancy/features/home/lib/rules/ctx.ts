export interface RuleCtx {
  now: Date;
  /** Tenant timezone (tenants.timezone). Every day boundary is cut here, never in the server's zone. */
  tz: string;
}
