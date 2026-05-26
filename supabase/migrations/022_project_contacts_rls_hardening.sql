-- 022_project_contacts_rls_hardening.sql
-- Tighten project_contacts policies to check BOTH the contact-side AND
-- the project-side tenant. Without the project-side check, an admin in
-- tenant A could insert a junction row pointing at tenant B's project
-- (the row would appear in B's project contact list as a ghost link).

DROP POLICY "project_contacts_select" ON project_contacts;
DROP POLICY "project_contacts_insert" ON project_contacts;
DROP POLICY "project_contacts_delete" ON project_contacts;

CREATE POLICY "project_contacts_select" ON project_contacts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.tenant_id IN (SELECT get_user_tenant_ids()))
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.tenant_id IN (SELECT get_user_tenant_ids()))
  );

CREATE POLICY "project_contacts_insert" ON project_contacts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND is_tenant_admin(p.tenant_id))
  );

CREATE POLICY "project_contacts_delete" ON project_contacts
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
    AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND is_tenant_admin(p.tenant_id))
  );
