-- Add UPDATE policy for tenants table
-- Previously only SELECT policies existed, preventing settings updates

CREATE POLICY "Admins can update tenants" ON tenants
  FOR UPDATE USING (is_tenant_admin(id));
