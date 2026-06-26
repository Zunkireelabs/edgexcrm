-- 070_restrict_reconcile_rpc.sql
-- Lock reconcile_import_sources EXECUTE to service_role (server-only). It's SECURITY DEFINER and
-- was PUBLIC-executable, allowing cross-tenant reads via a forged p_tenant. Helper uses the service
-- client, so this is non-breaking.
-- Rollback: GRANT EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) TO PUBLIC;
BEGIN;
REVOKE EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) TO service_role;
COMMIT;
