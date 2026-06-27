-- Pre-flight: run this on the target DB before applying. If any rows return, STOP — duplicates exist.
-- SELECT tenant_id, display_id, count(*) FROM leads WHERE display_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;

-- Hard unique backstop: prevents display_id collisions from concurrent creates.
-- Partial (WHERE display_id IS NOT NULL) so NULL staging rows don't conflict with each other.
-- NOT in a transaction: CREATE INDEX CONCURRENTLY cannot run inside BEGIN/COMMIT.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS uq_leads_tenant_display_id;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_tenant_display_id
  ON public.leads (tenant_id, display_id)
  WHERE display_id IS NOT NULL;
